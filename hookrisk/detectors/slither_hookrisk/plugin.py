"""Slither plugin entry point.

Slither discovers detectors through the ``slither_analyzer.plugin`` entry point
declared in pyproject.toml. It calls ``make_plugin()`` and expects a pair of
lists: detector classes and printer classes.

Registering here rather than by directory scan is deliberate — a detector that
is written but not listed does not silently ship, and the order of this list is
the order findings appear.
"""

from __future__ import annotations

from typing import Type

from slither.detectors.abstract_detector import AbstractDetector
from slither.printers.abstract_printer import AbstractPrinter

from .detectors.disabled_callback import CallbackIntentionallyDisabled
from .detectors.hook_profile import HookProfile
from .detectors.hs01_unprotected_callback import UnprotectedHookCallback
from .detectors.hs02_flag_divergence import (
    CustomAccountingDeclared,
    FlagImplementationDivergence,
)
from .detectors.hs03_admin_surface import AdminSurface
from .detectors.hs05_external_call import ExternalCallInSwapPath
from .detectors.hs06_dynamic_fee import UnboundedDynamicFee
from .detectors.unsupported_abi import UnsupportedHookAbi

#: Every detector, most severe class first. The classifications come last;
#: `UnsupportedHookAbi` is the only one that fires on contracts the others
#: skip, and `HookProfile` is the one that fires on every contract they do.
DETECTORS: list[Type[AbstractDetector]] = [
    UnprotectedHookCallback,
    FlagImplementationDivergence,
    AdminSurface,
    ExternalCallInSwapPath,
    UnboundedDynamicFee,
    CustomAccountingDeclared,
    CallbackIntentionallyDisabled,
    UnsupportedHookAbi,
    HookProfile,
]

PRINTERS: list[Type[AbstractPrinter]] = []


def make_plugin() -> tuple[list[Type[AbstractDetector]], list[Type[AbstractPrinter]]]:
    """Return the detectors and printers this plugin provides."""
    return DETECTORS, PRINTERS
