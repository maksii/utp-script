#!/usr/bin/env python3
"""Export a selected folder as a JSON tree for bulk-track path analysis."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def pick_folder() -> Path | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return None

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    chosen = filedialog.askdirectory(title="Select folder to export as JSON tree")
    root.destroy()
    return Path(chosen) if chosen else None


def build_tree(path: Path, root: Path) -> dict:
    node: dict = {
        "name": path.name,
        "type": "dir" if path.is_dir() else "file",
        "rel_path": "." if path == root else path.relative_to(root).as_posix(),
    }

    if path.is_file():
        node["ext"] = path.suffix.lower()
        return node

    children: list[dict] = []
    try:
        entries = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.casefold()))
    except PermissionError as exc:
        node["error"] = str(exc)
        node["children"] = []
        return node

    for entry in entries:
        if entry.name.startswith("."):
            continue
        children.append(build_tree(entry, root))

    node["children"] = children
    return node


def collect_files(node: dict, out: list[dict] | None = None) -> list[dict]:
    if out is None:
        out = []
    if node.get("type") == "file":
        out.append(
            {
                "name": node["name"],
                "ext": node.get("ext", ""),
                "rel_path": node["rel_path"],
                "parts": [p for p in node["rel_path"].split("/") if p and p != "."],
            }
        )
    for child in node.get("children", []):
        collect_files(child, out)
    return out


def export(root: Path, out_path: Path) -> Path:
    root = root.resolve()
    if not root.is_dir():
        raise SystemExit(f"Not a directory: {root}")

    tree = build_tree(root, root)
    payload = {
        "root": str(root),
        "root_name": root.name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tree": tree,
        "files": collect_files(tree),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Export folder tree to JSON")
    parser.add_argument("folder", nargs="?", help="Folder to scan (opens picker if omitted)")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output JSON path (default: <script_dir>/<folder_name>_tree.json)",
    )
    args = parser.parse_args()

    folder = Path(args.folder) if args.folder else pick_folder()
    if folder is None:
        raise SystemExit("No folder selected.")

    out = args.output or (script_dir / f"{folder.resolve().name}_tree.json")
    written = export(folder, out)
    print(f"Wrote {written}")
    print(f"Files: {len(json.loads(written.read_text(encoding='utf-8'))['files'])}")


if __name__ == "__main__":
    main()
