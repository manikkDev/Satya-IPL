"""Driver equivalent to `flower-simulation`.

Ray builds its worker command by embedding ``sys.executable`` and the worker
script paths inside a shell ``exec`` line that does not survive spaces in the
interpreter location (e.g. ``~/Web Projects/...``). When the interpreter path
has spaces, run this via a space-free interpreter (an APFS clone of ``.venv``
works — set ``FLOWER_PYTHON`` for the API runner). The wrapper here covers the
remaining ``sys.executable`` token as defense-in-depth.

Usage: python -m arth_fl.simulate --app . --num-supernodes 5 --run-config "..."
"""
import os
import stat
import sys
import tempfile
from pathlib import Path


def _space_free_python():
    real = sys.executable
    if " " not in real:
        return real
    wrapper = Path(tempfile.gettempdir()) / "arth_flwr_python.sh"
    wrapper.write_text('#!/bin/bash\nexec "{}" "$@"\n'.format(real))
    wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return str(wrapper)


def main():
    sys.executable = _space_free_python()
    sys.argv = [sys.argv[0].replace("simulate", "flower-simulation")] + sys.argv[1:]
    from flwr.simulation.run_simulation import run_simulation_from_cli
    run_simulation_from_cli()


if __name__ == "__main__":
    main()
