"""Application entrypoint with modular feature routers."""

from server import (
    app,
    db,
    get_current_user,
    load_account_balance_breakdowns,
    amount_in_currency,
    normalize_currency,
)
from projection_api import create_projection_router

app.include_router(create_projection_router(
    db=db,
    get_current_user=get_current_user,
    load_account_balance_breakdowns=load_account_balance_breakdowns,
    amount_in_currency=amount_in_currency,
    normalize_currency=normalize_currency,
))
