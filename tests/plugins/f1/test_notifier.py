# tests/plugins/f1/test_notifier.py
import json
from vibebot.plugins.f1.notifier import (
    build_pre_session_blocks,
    build_post_fp_blocks,
    build_post_quali_blocks,
    build_post_sprint_quali_blocks,
    build_post_sprint_blocks,
    build_pre_race_blocks,
    build_post_race_blocks,
)

SESSION = {
    "session_key": "9158",
    "event_name": "Bahrain Grand Prix",
    "circuit": "Bahrain",
    "country": "Bahrain",
    "session_type": "Practice 1",
    "start_utc": "2026-03-20T11:30:00+00:00",
    "round_number": 1,
}

def _has_text(blocks, text):
    return text in json.dumps(blocks)

def test_pre_session_blocks_structure():
    blocks = build_pre_session_blocks(SESSION, display_tz="US/Eastern")
    assert isinstance(blocks, list)
    assert len(blocks) >= 2
    assert any(b["type"] == "header" for b in blocks)

def test_pre_session_blocks_contains_session_name():
    blocks = build_pre_session_blocks(SESSION, display_tz="US/Eastern")
    assert _has_text(blocks, "Practice 1")

def test_pre_session_blocks_contains_event():
    blocks = build_pre_session_blocks(SESSION, display_tz="US/Eastern")
    assert _has_text(blocks, "Bahrain")

def test_post_fp_blocks_structure():
    results = [
        {"driver_number": "1", "driver_code": "VER", "position": 1, "lap_duration": 89.456},
        {"driver_number": "16", "driver_code": "LEC", "position": 2, "lap_duration": 89.721},
        {"driver_number": "44", "driver_code": "HAM", "position": 3, "lap_duration": 89.850},
    ]
    blocks = build_post_fp_blocks(SESSION, results, display_tz="US/Eastern")
    assert isinstance(blocks, list)
    assert _has_text(blocks, "VER")

def test_post_quali_blocks_structure():
    grid = [
        {"position": "1", "Driver": {"code": "VER"}, "Constructor": {"name": "Red Bull"}, "Q3": "1:28.456"},
        {"position": "2", "Driver": {"code": "LEC"}, "Constructor": {"name": "Ferrari"}, "Q3": "1:28.712"},
    ]
    blocks = build_post_quali_blocks(SESSION, grid, display_tz="US/Eastern")
    assert isinstance(blocks, list)
    assert _has_text(blocks, "VER")

def test_pre_race_blocks_structure():
    grid = [
        {"position": "1", "Driver": {"code": "VER"}, "Constructor": {"name": "Red Bull"}},
        {"position": "2", "Driver": {"code": "LEC"}, "Constructor": {"name": "Ferrari"}},
    ]
    blocks = build_pre_race_blocks(SESSION, grid, display_tz="US/Eastern")
    assert isinstance(blocks, list)
    assert _has_text(blocks, "VER")

def test_post_race_blocks_structure():
    podium = [
        {"position": "1", "Driver": {"code": "VER", "givenName": "Max", "familyName": "Verstappen"},
         "Constructor": {"name": "Red Bull"}, "Time": {"time": "1:31:05.123"}},
        {"position": "2", "Driver": {"code": "LEC", "givenName": "Charles", "familyName": "Leclerc"},
         "Constructor": {"name": "Ferrari"}, "Time": {"millis": "1234567"}},
        {"position": "3", "Driver": {"code": "HAM", "givenName": "Lewis", "familyName": "Hamilton"},
         "Constructor": {"name": "Mercedes"}, "Time": {"millis": "2345678"}},
    ]
    blocks = build_post_race_blocks(SESSION, podium, display_tz="US/Eastern")
    assert isinstance(blocks, list)
    assert _has_text(blocks, "VER")
    assert _has_text(blocks, "Bahrain")

def test_post_sprint_quali_blocks_structure():
    grid = [
        {"position": "1", "Driver": {"code": "VER"}, "Constructor": {"name": "Red Bull"}, "Q2": "1:05.123"},
        {"position": "2", "Driver": {"code": "LEC"}, "Constructor": {"name": "Ferrari"}, "Q2": "1:05.456"},
    ]
    blocks = build_post_sprint_quali_blocks(SESSION, grid, display_tz="US/Eastern")
    assert isinstance(blocks, list)
    assert _has_text(blocks, "VER")
    assert _has_text(blocks, "Sprint Qualifying")


def test_post_sprint_blocks_structure():
    results = [
        {"position": "1", "Driver": {"code": "VER"}, "Constructor": {"name": "Red Bull"},
         "Time": {"time": "25:01.234"}},
        {"position": "2", "Driver": {"code": "LEC"}, "Constructor": {"name": "Ferrari"},
         "Time": {"time": "+5.678"}},
    ]
    blocks = build_post_sprint_blocks(SESSION, results, display_tz="US/Eastern")
    assert isinstance(blocks, list)
    assert _has_text(blocks, "VER")
    assert _has_text(blocks, "Sprint Race Result")
