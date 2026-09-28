from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from statement_import_api import create_statement_import_router


# ------------------------------------------------------------ fake MongoDB

def _matches(document, query):
    for key, condition in query.items():
        value = document.get(key)
        if isinstance(condition, dict):
            for operator, operand in condition.items():
                if operator == "$in" and value not in operand:
                    return False
                if operator == "$exists" and (key in document) != operand:
                    return False
                if operator == "$type" and operand == "string" and not isinstance(value, str):
                    return False
                if operator == "$gte" and not (value is not None and value >= operand):
                    return False
                if operator == "$lte" and not (value is not None and value <= operand):
                    return False
        elif value != condition:
            return False
    return True


class FakeCursor:
    def __init__(self, documents):
        self.documents = list(documents)

    def sort(self, field, direction):
        self.documents.sort(key=lambda doc: doc.get(field) or "", reverse=direction < 0)
        return self

    def limit(self, count):
        self.documents = self.documents[:count]
        return self

    async def to_list(self, _limit):
        return [dict(doc) for doc in self.documents]

    def __aiter__(self):
        self._iterator = iter(self.documents)
        return self

    async def __anext__(self):
        try:
            return dict(next(self._iterator))
        except StopIteration:
            raise StopAsyncIteration


class FakeCollection:
    def __init__(self, documents=None, unique=None):
        self.documents = [dict(doc) for doc in documents or []]
        self.unique = unique

    def find(self, query, _projection=None):
        return FakeCursor(doc for doc in self.documents if _matches(doc, query))

    async def find_one(self, query, _projection=None):
        return next((dict(doc) for doc in self.documents if _matches(doc, query)), None)

    async def count_documents(self, query):
        return sum(1 for doc in self.documents if _matches(doc, query))

    async def insert_one(self, document):
        self.documents.append(dict(document))

    async def insert_many(self, documents, ordered=True):
        for document in documents:
            if self.unique and any(
                all(existing.get(field) == document.get(field) for field in self.unique)
                for existing in self.documents
            ):
                continue
            self.documents.append(dict(document))
        return SimpleNamespace(inserted_ids=[doc["id"] for doc in documents])

    async def update_one(self, query, update):
        for document in self.documents:
            if _matches(document, query):
                document.update(update["$set"])
                return

    async def delete_one(self, query):
        before = len(self.documents)
        for index, document in enumerate(self.documents):
            if _matches(document, query):
                del self.documents[index]
                break
        return SimpleNamespace(deleted_count=before - len(self.documents))

    async def delete_many(self, query):
        before = len(self.documents)
        self.documents = [doc for doc in self.documents if not _matches(doc, query)]
        return SimpleNamespace(deleted_count=before - len(self.documents))


class FakeDatabase:
    def __init__(self):
        self.accounts = FakeCollection([
            {"id": "acc-1", "user_id": "me", "name": "Conta", "currency": "EUR"},
            {"id": "acc-old", "user_id": "me", "name": "Velha", "archived": True},
            {"id": "acc-other", "user_id": "someone-else", "name": "Alheia"},
        ])
        self.categories = FakeCollection([
            {"id": "cat-food", "user_id": "me", "name": "Mercado", "kind": "expense"},
            {"id": "cat-salary", "user_id": "me", "name": "Salário", "kind": "income"},
            {"id": "cat-coffee", "user_id": "me", "name": "Café", "kind": "expense"},
            {"id": "cat-foreign", "user_id": "someone-else", "name": "X", "kind": "both"},
        ])
        self.transactions = FakeCollection(unique=("user_id", "import_fingerprint"))
        self.import_rules = FakeCollection()


class TransactionModel(BaseModel):
    type: str
    date: str
    amount: float
    category_id: str | None = None
    account_id: str | None = None
    description: str = ""
    status: str = "paid"


async def fake_transaction_values(payload, _user):
    return payload.model_dump()


def make_client(database):
    counter = iter(range(1, 100000))
    app = FastAPI()
    app.include_router(create_statement_import_router(
        db=database,
        get_current_user=lambda: {"id": "me", "currency": "EUR"},
        transaction_values=fake_transaction_values,
        transaction_model=TransactionModel,
        new_id=lambda: f"id-{next(counter)}",
        now_iso=lambda: "2026-09-28T12:00:00+00:00",
    ))
    return TestClient(app)


CSV = (
    "Data;Descrição;Valor\n"
    "01/09/2026;SUPERMERCADO LIDL 123;-45,10\n"
    "02/09/2026;SALARIO EMPRESA;2.000,00\n"
    "03/09/2026;CAFE CENTRAL;-3,50\n"
)


def preview(client, content=CSV, account_id="acc-1", **extra):
    return client.post("/api/statement-imports/preview", json={
        "account_id": account_id, "filename": "extrato.csv", "content": content, **extra,
    })


def commit_all(client, rows, account_id="acc-1"):
    return client.post("/api/statement-imports/commit", json={
        "account_id": account_id,
        "rows": [
            {key: row[key] for key in ("row_id", "date", "description", "amount", "type", "category_id")}
            for row in rows
        ],
    })


# ------------------------------------------------------------------- tests

def test_preview_classifies_rows_and_suggests_nothing_without_history():
    response = preview(make_client(FakeDatabase()))

    assert response.status_code == 200
    body = response.json()
    assert body["format"] == "csv"
    assert [(r["type"], r["amount"], r["status"]) for r in body["rows"]] == [
        ("expense", 45.1, "new"), ("income", 2000.0, "new"), ("expense", 3.5, "new"),
    ]
    assert all(row["category_id"] is None for row in body["rows"])


def test_accounts_of_other_users_and_archived_accounts_are_rejected():
    client = make_client(FakeDatabase())

    assert preview(client, account_id="acc-other").status_code == 404
    assert preview(client, account_id="acc-old").status_code == 400


def test_unknown_columns_return_headers_for_manual_mapping():
    response = preview(make_client(FakeDatabase()), content="A;B;C\n01/09/2026;x;-1,00\n")

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "mapping_required"
    assert response.json()["detail"]["headers"] == ["A", "B", "C"]


def test_commit_creates_paid_transactions_and_reimport_is_detected_and_skipped():
    database = FakeDatabase()
    client = make_client(database)
    rows = preview(client).json()["rows"]
    rows[0]["category_id"] = "cat-food"

    first = commit_all(client, rows)

    assert first.status_code == 200
    assert first.json()["imported"] == 3
    stored = database.transactions.documents
    assert {doc["status"] for doc in stored} == {"paid"}
    assert {doc["user_id"] for doc in stored} == {"me"}
    assert stored[0]["category_id"] == "cat-food"
    assert stored[0]["import_batch_id"] == first.json()["batch_id"]

    again = preview(client).json()["rows"]
    assert {row["status"] for row in again} == {"imported"}
    second = commit_all(client, again)
    assert second.json() == {"batch_id": None, "imported": 0, "skipped": 3}
    assert len(database.transactions.documents) == 3


def test_manually_entered_transaction_is_flagged_as_possible_duplicate():
    database = FakeDatabase()
    database.transactions.documents.append({
        "id": "manual", "user_id": "me", "account_id": "acc-1",
        "date": "2026-09-03", "type": "expense", "amount": 3.5,
    })

    rows = preview(make_client(database)).json()["rows"]

    assert [row["status"] for row in rows] == ["new", "new", "possible_duplicate"]


def test_history_and_rules_suggest_categories_with_rules_taking_priority():
    database = FakeDatabase()
    database.transactions.documents.append({
        "id": "old", "user_id": "me", "account_id": "acc-1", "date": "2026-08-01",
        "type": "expense", "amount": 40, "description": "Supermercado Lidl 999",
        "category_id": "cat-food",
    })
    client = make_client(database)

    rows = preview(client).json()["rows"]
    assert (rows[0]["category_id"], rows[0]["category_source"]) == ("cat-food", "history")

    assert client.post("/api/statement-imports/rules", json={
        "pattern": "Café", "category_id": "cat-coffee",
    }).status_code == 200
    assert client.post("/api/statement-imports/rules", json={
        "pattern": "Salario", "category_id": "cat-salary", "type": "income",
    }).status_code == 200

    rows = preview(client).json()["rows"]
    assert [(r["category_id"], r["category_source"]) for r in rows] == [
        ("cat-food", "history"), ("cat-salary", "rule"), ("cat-coffee", "rule"),
    ]


def test_rules_reject_foreign_or_incompatible_categories_and_can_be_deleted():
    client = make_client(FakeDatabase())

    assert client.post("/api/statement-imports/rules", json={
        "pattern": "abc", "category_id": "cat-foreign",
    }).status_code == 400
    assert client.post("/api/statement-imports/rules", json={
        "pattern": "abc", "category_id": "cat-food", "type": "income",
    }).status_code == 400

    created = client.post("/api/statement-imports/rules", json={
        "pattern": "  uber   trip ", "category_id": "cat-food",
    }).json()
    assert created["pattern"] == "uber trip"
    assert [rule["id"] for rule in client.get("/api/statement-imports/rules").json()] == [created["id"]]
    assert client.delete(f"/api/statement-imports/rules/{created['id']}").status_code == 200
    assert client.get("/api/statement-imports/rules").json() == []


def test_commit_rejects_category_of_wrong_kind():
    client = make_client(FakeDatabase())
    rows = preview(client).json()["rows"]
    rows[1]["category_id"] = "cat-food"  # income row with an expense category

    assert commit_all(client, rows).status_code == 400


def test_undo_removes_only_the_batch_of_the_current_user():
    database = FakeDatabase()
    client = make_client(database)
    batch = commit_all(client, preview(client).json()["rows"]).json()["batch_id"]
    database.transactions.documents.append({
        "id": "foreign", "user_id": "someone-else", "import_batch_id": batch,
    })

    response = client.delete(f"/api/statement-imports/batches/{batch}")

    assert response.json() == {"deleted": 3}
    assert [doc["id"] for doc in database.transactions.documents] == ["foreign"]
