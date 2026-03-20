# tests/plugins/f1/test_results.py
from unittest.mock import patch, MagicMock
from vibebot.plugins.f1.results import (
    fetch_fp_top_times,
    fetch_quali_grid,
    fetch_race_result,
    fetch_sprint_result,
)

FAKE_LAPS = [
    {"driver_number": 1,  "lap_duration": 89.456, "lap_number": 5,  "is_pit_out_lap": False},
    {"driver_number": 1,  "lap_duration": 88.100, "lap_number": 10, "is_pit_out_lap": False},
    {"driver_number": 16, "lap_duration": 89.721, "lap_number": 5,  "is_pit_out_lap": False},
    {"driver_number": 16, "lap_duration": None,   "lap_number": 8,  "is_pit_out_lap": True},
]

FAKE_DRIVERS = [
    {"driver_number": 1,  "name_acronym": "VER"},
    {"driver_number": 16, "name_acronym": "LEC"},
]

def test_fetch_fp_top_times_best_lap_per_driver():
    with patch("vibebot.plugins.f1.results.requests.get") as mock_get:
        def side_effect(url, **kwargs):
            r = MagicMock()
            r.raise_for_status.return_value = None
            if "laps" in url:
                r.json.return_value = FAKE_LAPS
            else:
                r.json.return_value = FAKE_DRIVERS
            return r
        mock_get.side_effect = side_effect
        results = fetch_fp_top_times(session_key="9158")
    # VER best lap = 88.100, LEC = 89.721
    assert results[0]["driver_code"] == "VER"
    assert results[0]["lap_duration"] == 88.100
    assert results[1]["driver_code"] == "LEC"

def test_fetch_fp_top_times_excludes_pit_out_and_null():
    with patch("vibebot.plugins.f1.results.requests.get") as mock_get:
        def side_effect(url, **kwargs):
            r = MagicMock()
            r.raise_for_status.return_value = None
            if "laps" in url:
                r.json.return_value = FAKE_LAPS
            else:
                r.json.return_value = FAKE_DRIVERS
            return r
        mock_get.side_effect = side_effect
        results = fetch_fp_top_times(session_key="9158")
    # LEC's null/pit-out lap should be excluded from best time
    assert results[1]["lap_duration"] == 89.721

FAKE_QUALI_RESP = {
    "MRData": {
        "RaceTable": {
            "Races": [{
                "QualifyingResults": [
                    {"position": "1", "Driver": {"code": "VER"}, "Constructor": {"name": "Red Bull"}, "Q3": "1:28.456"},
                    {"position": "2", "Driver": {"code": "LEC"}, "Constructor": {"name": "Ferrari"}, "Q3": "1:28.712"},
                ]
            }]
        }
    }
}

def test_fetch_quali_grid_returns_list():
    with patch("vibebot.plugins.f1.results.requests.get") as mock_get:
        r = MagicMock()
        r.raise_for_status.return_value = None
        r.json.return_value = FAKE_QUALI_RESP
        mock_get.return_value = r
        grid = fetch_quali_grid(year=2026, round_number=1)
    assert len(grid) == 2
    assert grid[0]["Driver"]["code"] == "VER"

def test_fetch_quali_grid_empty_on_no_race():
    with patch("vibebot.plugins.f1.results.requests.get") as mock_get:
        r = MagicMock()
        r.raise_for_status.return_value = None
        r.json.return_value = {"MRData": {"RaceTable": {"Races": []}}}
        mock_get.return_value = r
        grid = fetch_quali_grid(year=2026, round_number=1)
    assert grid == []

FAKE_RACE_RESP = {
    "MRData": {
        "RaceTable": {
            "Races": [{
                "Results": [
                    {"position": "1", "Driver": {"code": "VER", "givenName": "Max", "familyName": "Verstappen"},
                     "Constructor": {"name": "Red Bull"}, "Time": {"time": "1:31:05.123"}},
                ]
            }]
        }
    }
}

def test_fetch_race_result_returns_list():
    with patch("vibebot.plugins.f1.results.requests.get") as mock_get:
        r = MagicMock()
        r.raise_for_status.return_value = None
        r.json.return_value = FAKE_RACE_RESP
        mock_get.return_value = r
        results = fetch_race_result(year=2026, round_number=1)
    assert results[0]["Driver"]["code"] == "VER"

FAKE_SPRINT_RESP = {
    "MRData": {
        "RaceTable": {
            "Races": [{
                "SprintResults": [
                    {"position": "1", "Driver": {"code": "VER"}, "Constructor": {"name": "Red Bull"},
                     "Time": {"time": "25:01.234"}},
                ]
            }]
        }
    }
}

def test_fetch_sprint_result_returns_list():
    with patch("vibebot.plugins.f1.results.requests.get") as mock_get:
        r = MagicMock()
        r.raise_for_status.return_value = None
        r.json.return_value = FAKE_SPRINT_RESP
        mock_get.return_value = r
        results = fetch_sprint_result(year=2026, round_number=1)
    assert results[0]["Driver"]["code"] == "VER"
