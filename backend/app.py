"""Compatibility entrypoint for the production ASGI application.

Feature routers are registered by ``server`` so both the historical
``server:app`` command and the preferred ``app:app`` command expose the same
API surface.
"""

from server import app
from linked_counterparty import install_linked_counterparty_routes


install_linked_counterparty_routes(app)
