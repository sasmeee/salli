# salli forecast: learns your daily spending and predicts the rest of the month
# input on stdin:  {"history": [{"date": "2026-10-01", "total": 2450}], "future": ["2026-10-26"], "salary_days": ["2026-10-01"]}
# output on stdout: {"preds": [1234.5, ...], "model": "TabPFN"}
# run "python forecast.py --setup" once to log in and download the model

import json
import sys
from datetime import date

MIN_DAYS = 14


def features(days, salary_days):
    pays = sorted(salary_days)
    rows = []
    for d in days:
        last = [p for p in pays if p <= d]
        since = (d - last[-1]).days if last else 99
        rows.append([d.weekday(), 1 if d.weekday() >= 5 else 0, d.day, since])
    return rows


def run(data):
    from tabpfn import TabPFNRegressor

    history = [(date.fromisoformat(h["date"]), float(h["total"])) for h in data["history"]]
    future = [date.fromisoformat(f) for f in data["future"]]
    salary = [date.fromisoformat(s) for s in data.get("salary_days", [])]

    if len(history) < MIN_DAYS:
        raise SystemExit(f"need at least {MIN_DAYS} days of history, have {len(history)}")
    if not future:
        return {"preds": [], "model": "TabPFN"}

    x = features([d for d, _ in history], salary)
    y = [t for _, t in history]

    model = TabPFNRegressor(device="cpu")
    model.fit(x, y)
    preds = model.predict(features(future, salary))
    return {"preds": [max(0.0, float(p)) for p in preds], "model": "TabPFN"}


def setup():
    # tiny fake data just to trigger the login and model download
    from tabpfn import TabPFNRegressor

    model = TabPFNRegressor(device="cpu")
    model.fit([[i % 7, 0, i, i] for i in range(20)], [float(i * 100) for i in range(20)])
    model.predict([[1, 0, 21, 21]])
    print("tabpfn is ready")


if __name__ == "__main__":
    if "--setup" in sys.argv:
        setup()
    else:
        print(json.dumps(run(json.load(sys.stdin))))
