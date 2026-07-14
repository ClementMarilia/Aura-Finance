"""One-time cleanup: remove duplicate recurrence-materialized transactions.

A duplicate is more than one transaction sharing the same
(user_id, recurrence_id, date). We keep a single one per group, preferring a
"paid" record (to preserve history); the rest are deleted.
"""
import os
from collections import defaultdict

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")

client = MongoClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

cursor = db.transactions.find(
    {"recurrence_id": {"$ne": None}},
    {"_id": 0, "id": 1, "user_id": 1, "recurrence_id": 1, "date": 1, "status": 1},
)

groups = defaultdict(list)
for t in cursor:
    key = (t.get("user_id"), t.get("recurrence_id"), t.get("date"))
    groups[key].append(t)

to_delete = []
dup_groups = 0
for key, txs in groups.items():
    if len(txs) <= 1:
        continue
    dup_groups += 1
    # Keep one: prefer a paid record, else the first.
    txs_sorted = sorted(txs, key=lambda x: 0 if x.get("status") == "paid" else 1)
    keep = txs_sorted[0]
    for t in txs_sorted[1:]:
        to_delete.append(t["id"])

print(f"Grupos com duplicatas: {dup_groups}")
print(f"Lançamentos duplicados a remover: {len(to_delete)}")

if to_delete:
    res = db.transactions.delete_many({"id": {"$in": to_delete}})
    print(f"Removidos: {res.deleted_count}")
else:
    print("Nada para remover.")
