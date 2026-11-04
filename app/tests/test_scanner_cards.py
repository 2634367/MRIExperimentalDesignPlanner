"""The shared scanner card library: seeded once from the bundled cards, edited
with the same revision check as an experiment, never emptied, and a delete
that can be undone for a while."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.core import db
from app.core.db import BUCKET_SCANNER_CARDS
from app.models import RestoreForbiddenError, scanner_cards, users
from app.models.scanner_cards import BadCardError, CardConflictError, LastCardError, NoSuchCardError


class ScannerCardsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.store = db.Store(Path(self.directory.name) / "app.db", "", False)
        self.store.initialise()
        self.alice = users.create_user(self.store, "Alice", users.ROLE_USER)
        self.bob = users.create_user(self.store, "Bob", users.ROLE_USER)

    def tearDown(self) -> None:
        self.directory.cleanup()

    def blank(self, label: str = "Test card") -> dict:
        return {"label": label, "role": "functional", "note": "", "pages": [{"name": "INFO PAGE", "rows": [
            {"parameter": "Total scan duration", "value": "05:00.0", "indent": 0},
        ]}]}

    def test_seed_loads_bundled_cards_once(self) -> None:
        added = scanner_cards.seed_cards(self.store)
        self.assertEqual(added, len(list(scanner_cards.SEED_DIR.glob("*.json"))))
        card = scanner_cards.get_card(self.store, "EPI-TR2000-Task")
        self.assertEqual(card.card["role"], "functional")
        self.assertEqual([page["name"] for page in card.card["pages"]][:2], ["INFO PAGE", "GEOMETRY"])
        # Functional cards come first in the list.
        self.assertEqual(scanner_cards.list_cards(self.store)[0].card["role"], "functional")
        self.assertEqual(scanner_cards.seed_cards(self.store), 0)

    def test_seed_does_not_refill_after_a_delete(self) -> None:
        scanner_cards.seed_cards(self.store)
        scanner_cards.delete_card(self.store, "T2-FLAIR", self.alice.id)
        self.assertEqual(scanner_cards.seed_cards(self.store), 0)
        with self.assertRaises(NoSuchCardError):
            scanner_cards.get_card(self.store, "T2-FLAIR")

    def test_create_gives_a_free_slug(self) -> None:
        first = scanner_cards.create_card(self.store, self.alice.id, self.blank("EPI fast!"))
        second = scanner_cards.create_card(self.store, self.alice.id, self.blank("EPI fast!"))
        self.assertEqual(first.id, "EPI-fast")
        self.assertEqual(second.id, "EPI-fast-2")

    def test_values_are_normalised(self) -> None:
        card = self.blank()
        card["role"] = "nonsense"
        card["pages"][0]["rows"].append({"parameter": "slices", "value": 36, "indent": 9})
        created = scanner_cards.create_card(self.store, self.alice.id, card)
        self.assertEqual(created.card["role"], "other")
        self.assertEqual(created.card["pages"][0]["rows"][1], {"parameter": "slices", "value": "36", "indent": 4})

    def test_bad_cards_are_refused(self) -> None:
        for bad in (None, {"label": "", "pages": []}, {"label": "x", "pages": "no"}, {"label": "x", "pages": [{"name": "", "rows": []}]}):
            with self.assertRaises(BadCardError):
                scanner_cards.create_card(self.store, self.alice.id, bad)

    def test_save_checks_the_revision(self) -> None:
        created = scanner_cards.create_card(self.store, self.alice.id, self.blank())
        edited = self.blank("Renamed")
        saved = scanner_cards.save_card(self.store, created.id, self.bob.id, edited, created.revision)
        self.assertEqual(saved.revision, 2)
        self.assertEqual(saved.id, created.id)
        with self.assertRaises(CardConflictError) as stale:
            scanner_cards.save_card(self.store, created.id, self.alice.id, edited, created.revision)
        self.assertEqual(stale.exception.current, 2)

    def test_last_card_cannot_be_deleted(self) -> None:
        one = scanner_cards.create_card(self.store, self.alice.id, self.blank("One"))
        two = scanner_cards.create_card(self.store, self.alice.id, self.blank("Two"))
        scanner_cards.delete_card(self.store, one.id, self.alice.id)
        with self.assertRaises(LastCardError):
            scanner_cards.delete_card(self.store, two.id, self.alice.id)

    def test_delete_is_restorable_by_whoever_deleted_it(self) -> None:
        scanner_cards.create_card(self.store, self.alice.id, self.blank("Keep"))
        gone = scanner_cards.create_card(self.store, self.alice.id, self.blank("Gone"))
        scanner_cards.delete_card(self.store, gone.id, self.alice.id)
        self.assertNotIn(gone.id, [card.id for card in scanner_cards.list_cards(self.store)])
        with self.assertRaises(RestoreForbiddenError):
            scanner_cards.restore_card(self.store, gone.id, self.bob.id, False)
        restored = scanner_cards.restore_card(self.store, gone.id, self.alice.id, False)
        self.assertEqual(restored.card["label"], "Gone")
        # A deleted card still holds its slug, so a restore never collides.
        self.assertEqual(scanner_cards.create_card(self.store, self.alice.id, self.blank("Gone")).id, "Gone-2")

    def test_purge_removes_only_long_deleted(self) -> None:
        scanner_cards.create_card(self.store, self.alice.id, self.blank("Keep"))
        gone = scanner_cards.create_card(self.store, self.alice.id, self.blank("Gone"))
        scanner_cards.delete_card(self.store, gone.id, self.alice.id)
        self.assertEqual(scanner_cards.purge_deleted_cards(self.store), 0)
        self.assertIsNotNone(self.store.get(BUCKET_SCANNER_CARDS, gone.id))


if __name__ == "__main__":
    unittest.main()
