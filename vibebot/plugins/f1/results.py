"""
Fetch post-session results from OpenF1 (FP times) and Jolpica (quali/race grids).
"""
import logging
from collections import defaultdict

import requests

log = logging.getLogger(__name__)

_OPENF1 = "https://api.openf1.org/v1"
_JOLPICA = "https://api.jolpica.com/ergast/v1/f1"


def fetch_fp_top_times(session_key: str) -> list[dict]:
    """
    Return drivers sorted by their best valid lap time in a practice session.
    Each entry: {driver_number, driver_code, position, lap_duration}
    """
    laps_resp = requests.get(f"{_OPENF1}/laps", params={"session_key": session_key}, timeout=20)
    laps_resp.raise_for_status()
    laps = laps_resp.json()

    drivers_resp = requests.get(f"{_OPENF1}/drivers", params={"session_key": session_key}, timeout=15)
    drivers_resp.raise_for_status()
    drivers = {d["driver_number"]: d.get("name_acronym", str(d["driver_number"]))
               for d in drivers_resp.json()}

    best: dict[int, float] = defaultdict(lambda: float("inf"))
    for lap in laps:
        if lap.get("is_pit_out_lap"):
            continue
        dur = lap.get("lap_duration")
        if dur is None:
            continue
        num = lap["driver_number"]
        if dur < best[num]:
            best[num] = dur

    results = [
        {"driver_number": num, "driver_code": drivers.get(num, str(num)),
         "lap_duration": dur, "position": 0}
        for num, dur in best.items()
        if dur < float("inf")
    ]
    results.sort(key=lambda r: r["lap_duration"])
    for i, r in enumerate(results):
        r["position"] = i + 1
    return results


def fetch_quali_grid(year: int, round_number: int) -> list[dict]:
    """Return the qualifying grid from Jolpica."""
    url = f"{_JOLPICA}/{year}/{round_number}/qualifying.json"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    races = resp.json()["MRData"]["RaceTable"]["Races"]
    if not races:
        return []
    return races[0].get("QualifyingResults", [])


def fetch_race_result(year: int, round_number: int) -> list[dict]:
    """Return the race result from Jolpica."""
    url = f"{_JOLPICA}/{year}/{round_number}/results.json"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    races = resp.json()["MRData"]["RaceTable"]["Races"]
    if not races:
        return []
    return races[0].get("Results", [])


def fetch_sprint_result(year: int, round_number: int) -> list[dict]:
    """Return the sprint race result from Jolpica."""
    url = f"{_JOLPICA}/{year}/{round_number}/sprint.json"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    races = resp.json()["MRData"]["RaceTable"]["Races"]
    if not races:
        return []
    return races[0].get("SprintResults", [])
