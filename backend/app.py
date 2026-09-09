"""Compatibility entrypoint for the production ASGI application.

Feature routers are registered by ``server`` so both the historical
``server:app`` command and the preferred ``app:app`` command expose the same
API surface.
"""

import server
from linked_counterparty import install_linked_counterparty_routes


app = server.app

# The legacy Emergent Object Storage integration is only needed when a user
# accesses receipt attachments. Initializing it during application startup
# makes every Render boot call the external Emergent endpoint, which is no
# longer reliable in production. Defer that initialization until first use
# without changing the existing receipt upload/download implementation.
_original_startup = server.startup
_original_init_storage = server.init_storage
_original_logger_info = server.logger.info


async def _startup_without_eager_storage():
    def _deferred_storage_init():
        return None

    def _startup_info(message, *args, **kwargs):
        if message == "Object storage initialized":
            server.logger.info = _original_logger_info
            _original_logger_info(
                "Object storage initialization deferred until first receipt access"
            )
            server.logger.info = _startup_info
            return
        _original_logger_info(message, *args, **kwargs)

    server.init_storage = _deferred_storage_init
    server.logger.info = _startup_info
    try:
        await _original_startup()
    finally:
        server.init_storage = _original_init_storage
        server.logger.info = _original_logger_info


app.router.on_startup = [
    _startup_without_eager_storage if handler is _original_startup else handler
    for handler in app.router.on_startup
]

install_linked_counterparty_routes(app)
