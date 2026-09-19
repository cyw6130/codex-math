"""Native rollout parsing adapted from Skill OS 2.0.6 fact_system/review.py."""
import json
from pathlib import Path
from typing import Any, Mapping
class ReviewError(ValueError):
    pass

def _rollout_events(path: Path) -> list[dict[str, Any]]:
    try:
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ReviewError("native subagent rollout JSONL is invalid") from exc


def _output_text(payload: Mapping[str, Any]) -> str:
    content = payload.get("content")
    if not isinstance(content, list):
        raise ReviewError("native subagent final content is invalid")
    parts = [item.get("text") for item in content
             if isinstance(item, dict) and item.get("type") == "output_text"]
    if not parts or any(not isinstance(item, str) for item in parts):
        raise ReviewError("native subagent final output_text is missing")
    return "".join(parts)


def _latest_completed_turn(events: list[dict[str, Any]]) -> tuple[str, int, int]:
    starts = [(index, event.get("payload", {})) for index, event in enumerate(events)
              if event.get("type") == "event_msg"
              and event.get("payload", {}).get("type") == "task_started"]
    completes = [(index, event.get("payload", {})) for index, event in enumerate(events)
                 if event.get("type") == "event_msg"
                 and event.get("payload", {}).get("type") == "task_complete"]
    if not starts or not completes:
        raise ReviewError("native subagent rollout lacks a completed task turn")
    start_index, start = starts[-1]
    complete_index, complete = completes[-1]
    turn_id = start.get("turn_id")
    if (complete_index < start_index or not isinstance(turn_id, str) or not turn_id
            or complete.get("turn_id") != turn_id):
        raise ReviewError("latest native subagent task turn is incomplete or mismatched")
    return turn_id, start_index, complete_index


def _native_final_report(events: list[dict[str, Any]]) -> dict[str, Any]:
    turn_id, start_index, complete_index = _latest_completed_turn(events)
    finals = [event.get("payload", {}) for index, event in enumerate(events)
              if start_index < index < complete_index
              and event.get("type") == "response_item"
              and event.get("payload", {}).get("type") == "message"
              and event.get("payload", {}).get("role") == "assistant"
              and event.get("payload", {}).get("phase") == "final_answer"
              and event.get("payload", {}).get(
                  "internal_chat_message_metadata_passthrough", {}
              ).get("turn_id") == turn_id]
    if len(finals) != 1:
        raise ReviewError("latest completed native subagent turn must contain one assistant final response")
    try:
        value = json.loads(_output_text(finals[0]))
    except json.JSONDecodeError as exc:
        raise ReviewError("native subagent final response is not receipt JSON") from exc
    required = {"packet_sha256", "verdicts_path", "verdicts_sha256", "review_scope",
                "accepted_count", "rejected_count"}
    allowed = required | {"review_path", "review_sha256"}
    if (not isinstance(value, dict) or not required <= set(value) or not set(value) <= allowed
            or (("review_path" in value) != ("review_sha256" in value))):
        raise ReviewError("native subagent final receipt fields are invalid")
    completed = events[complete_index].get("payload", {})
    if completed.get("last_agent_message") != _output_text(finals[0]):
        raise ReviewError("native subagent rollout lacks a matching task_complete event")
    return value


def _native_metadata(events: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    metas = [event.get("payload", {}) for event in events if event.get("type") == "session_meta"]
    if len(metas) != 1:
        raise ReviewError("native subagent rollout must contain exactly one session_meta")
    turn_id, start_index, complete_index = _latest_completed_turn(events)
    contexts = [event.get("payload", {}) for index, event in enumerate(events)
                if start_index < index < complete_index
                and event.get("type") == "turn_context"
                and event.get("payload", {}).get("turn_id") == turn_id]
    if not contexts:
        raise ReviewError("latest completed native subagent turn lacks turn_context")
    # The host may repeat a context when resuming the same turn. Compare the
    # complete payload; do not discard differences in model, identity or scope.
    if any(context != contexts[0] for context in contexts[1:]):
        raise ReviewError("latest completed native subagent turn has conflicting turn_context records")
    return metas[0], contexts[0]


