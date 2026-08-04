"""Canonical contract for events shown on the financial timeline."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class FinancialEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    source: Literal["transaction", "recurrence", "installment", "receivable"]
    type: Literal["income", "expense", "transfer"]
    date: str
    title: str = ""
    amount: float = Field(ge=0)
    currency: str
    status: Literal["paid", "pending", "received", "cancelled"]
    account_id: Optional[str] = None
    account_ids: list[str] = Field(default_factory=list)
    category_id: Optional[str] = None
    recurrence_id: Optional[str] = None
    overdue: bool = False
    estimated: bool = False
    installment_number: Optional[int] = None
    installment_total: Optional[int] = None
