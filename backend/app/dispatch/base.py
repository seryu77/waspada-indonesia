"""Adapter pengiriman ke command center 112. Tidak ada adapter yang menelepon 112 secara langsung."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class DispatchResult:
    ok: bool
    note: str


class DispatchAdapter(ABC):
    mode: str

    @abstractmethod
    async def send(self, payload: dict) -> DispatchResult: ...
