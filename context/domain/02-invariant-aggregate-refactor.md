---
title: "Plan refaktoru: agregat-strażnik niezmiennika — 10xFiszki"
created: 2026-08-24
type: refactor-plan
---

# Plan refaktoru: agregat-strażnik niezmiennika

Ten dokument jest **planem**, nie implementacją. Nie modyfikuje kodu produkcyjnego. Buduje na
`context/domain/01-domain-distillation.md` (dalej: "Destylacja"), ale KROK 1 i KROK 2 są przeprowadzone
od nowa i samodzielnie — wybór niezmiennika #1 w tym dokumencie **różni się** od rankingu w Destylacji, z
uzasadnieniem w KROK 2.

## KROK 0 — Odkryty kontekst

Ponownie zweryfikowane bezpośrednim odczytem (nie tylko na podstawie Destylacji):
`src/pages/api/decks/[id]/cards.ts`, `src/pages/api/decks/[id]/cards/manual.ts`,
`src/pages/api/decks/[id]/cards/[cardId].ts`, `src/pages/api/decks/index.ts`,
`src/pages/api/decks/[id]/delete.ts`, `src/pages/api/decks/[id]/generate.ts`,
`src/pages/api/decks/[id]/review.ts`, `src/pages/api/decks/[id]/review-reset.ts`,
`src/lib/supabase.ts`, `src/middleware.ts`, `src/lib/openrouter.ts`, `src/lib/fsrs.ts`,
`supabase/migrations/*.sql` (6 plików), `context/foundation/prd.md`, `context/foundation/roadmap.md`,
`src/components/decks/GenerateFlashcardsPanel.tsx:105-161`, oraz — kluczowe nowe odkrycie względem
Destylacji — `tests/integration/cards-batch-insert.test.ts`.

**Nowe ustalenie nieobecne w Destylacji:** istnieje działający runner testów (Vitest; `package.json`:
`"test": "vitest run"`), wbrew stwierdzeniu w `CLAUDE.md` ("No test framework is configured yet" — to
zdanie jest już nieaktualne). Katalog `tests/integration/` zawiera testy kontraktowe uderzające w
prawdziwe route'y Astro przez `experimental_AstroContainer`, w tym **test, który jawnie asercjuje dzisiejsze
zachowanie diagnozowane w KROK 3** (`cards-batch-insert.test.ts:74-113`). To zmienia charakter refaktoru: nie
jest to "dodanie testów do nieotestowanego kodu", tylko "zmiana kontraktu, który jest już formalnie
zapisany w teście" — patrz KROK 5.

Stack potwierdzony: logika biznesowa żyje w cienkich handlerach Astro API (`src/pages/api/**`), bez
warstwy serwisu/domeny. Reguły integralności danych są w Postgresie (CHECK, unique index, RLS, FK
cascade). Klient Supabase jest zawsze tworzony z kontekstu żądania (`src/lib/supabase.ts:7-11`), nigdy
jako singleton z kluczem service-role — więc każdy zapytanie przechodzi przez RLS.

---

## KROK 1 — Zidentyfikowane niezmienniki biznesowe

| # | Niezmiennik | Źródło (dokument) | Źródło (kod) |
|---|---|---|---|
| I1 | Tekst bez ekstrahowalnych konceptów → zero lub prawie zero propozycji fiszek, nigdy "filler cards" | "Text that has no extractable concepts... should produce zero or near-zero proposals, not filler cards" — `prd.md:112` | Wyłącznie w treści promptu systemowego: `src/lib/openrouter.ts:13-14`. Brak mechanicznej weryfikacji poza kształtem stringów (`isValidProposal`, `openrouter.ts:25-36`). |
| I2 | `(deck_id, front, back)` unikalne w obrębie talii — żadne dwie karty w jednej talii nie mają identycznego front+back | Nieobecne w PRD — reguła istnieje tylko w kodzie/migracji | `create unique index cards_deck_id_front_back_hash_idx on cards (deck_id, (md5(front) \|\| md5(back)))` — `supabase/migrations/20260801114731_cards_unique_front_back.sql:5-6` |
| I3 | Zaakceptowane przez użytkownika dane (karty, postęp powtórek, stan planowania) nie mogą zostać cicho utracone przy zapisie ani na koniec sesji | "Card data (accepted cards, review progress, scheduling state) must never be silently lost on save or session end" — `prd.md:37`, powtórzone jako NFR `prd.md:101` | Brak jednego miejsca egzekwowania — patrz KROK 3, to jest korelat I2. |
| I4 | Talia i jej karty są widoczne/modyfikowalne wyłącznie przez właściciela; brak wyjątków | "No user's cards, decks, or review history are accessible to any other user under any circumstances" — `prd.md:99`; "An authenticated user can only access their own flashcards; no cross-user data access" — `prd.md:116` | Egzekwowane wyłącznie przez RLS-polityki `decks_*_own` / `cards_*_own` — `supabase/migrations/20260729164431_deck_card_schema_foundation.sql:59-131`. Zero filtrów `user_id`/`deck_id`-ownership w kodzie aplikacji (zweryfikowane: `cards.ts`, `cards/manual.ts`, `cards/[cardId].ts`, `review.ts`, `delete.ts` — żaden nie sprawdza właściciela poza samym `RLS`). |
| I5 | Nazwa talii unikalna per użytkownik (case-insensitive), 1–100 znaków, nie-pusta po trim | Wywiedzione z FR-004/005 (`prd.md:66-69`) | `unique index decks_user_id_lower_name_idx on decks (user_id, lower(name))` + `check (length(trim(name))>0 and length(name)<=100)` — `.../20260729164431_...sql:10,15` |
| I6 | `front`/`back` niepuste po trim, ≤2000 znaków (karta i propozycja) | FR-009 — `prd.md:80` | DB: `.../20260729164431_...sql:24-25`. Zduplikowane identycznie (funkcja `isValidCardInput`) w `cards.ts:9-20`, `cards/manual.ts:9-20`, `cards/[cardId].ts:9-20`. |
| I7 | Stan FSRS karty (`due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review`) musi pozostawać w kształcie akceptowanym przez `ts-fsrs`; tylko `state` ma twardą granicę 0-3 | Guardrail "scheduling state" — `prd.md:37,101` | `check (state between 0 and 3)` — `supabase/migrations/20260801130000_cards_fsrs_fields.sql:15`. `/review` (`review.ts:129-137`) zapisuje wynik `scheduler.next()` bez żadnej walidacji. `/review-reset` (`review-reset.ts:20-60`) ręcznie re-waliduje wszystkie 10 pól. |
| I8 | Konto w stanie oczekiwania na usunięcie jest zablokowane (poza cancel/signout) przez 30 dni, po czym dane są trwale usuwane | `context/archive/2026-08-02-account-deletion/change.md:14-15`; brak w `prd.md` | `account_deletion_requests` (PK `user_id`) — `.../20260802133021_...sql:3-6`; cron `requested_at < now() - interval '30 days'` — `.../20260802133023_...sql:12-13`; blokada w `src/middleware.ts:28-41`. |

Osiem niezmienników pokrywa wszystkie warstwy (prompt LLM, DB constraints, RLS, app-layer walidacja,
middleware, cron). KROK 2 wybiera jeden do dalszej diagnozy i projektu agregatu.

---

## KROK 2 — Klasyfikacja i wybór #1

Ocena na trzech osiach z brief: (a) rdzeniowość dla sensu produktu, (b) rozsmarowanie po
warstwach/plikach, (c) status egzekwowania (egzekwowany / tylko-deklarowany / naruszalny).

| # | Niezmiennik | (a) Rdzeniowość | (b) Rozsmarowanie | (c) Egzekwowanie |
|---|---|---|---|---|
| I1 | Zero konceptów → zero propozycji | **Najwyższa** — to jedyny mechanizm wprost opisany jako "Business Logic" w PRD (`prd.md:106-112`) i jedyny bezpośrednio sprzężony z metryką sukcesu (75% acceptance, `prd.md:31`) | Brak — żyje w jednym miejscu (prompt) | **Najsłabsze możliwe** — tylko-deklarowany, zero kodu weryfikującego, zero testów |
| I2+I3 | Unikalność karty w talii + brak cichej utraty zaakceptowanych danych | Wysoka — dotyczy dokładnie ścieżki accept/reject ocenianej metryką sukcesu (`prd.md:31,77`) i jawnego guardrail (`prd.md:37,101`) | **Wysokie** — trzy niezależne, rozbieżne implementacje tej samej reguły (`cards.ts`, `cards/manual.ts`, `cards/[cardId].ts`) | Naruszalny w sensie: DB constraint jest twardy, ale mechanizm egzekwowania w apce **łamie inny zadeklarowany niezmiennik (I3)** — patrz KROK 3 |
| I4 | Izolacja właściciela | Bardzo wysoka — twardy NFR bez wyjątków (`prd.md:99`) | Niskie/zero — scentralizowane w jednej warstwie (RLS), zero redundancji w apce | Dziś poprawnie egzekwowany, ale przez pojedynczą warstwę — brak defense-in-depth |
| I5 | Unikalność nazwy talii | Średnia (Supporting subdomain) | Niskie — jedno miejsce w apce + DB, spójna obsługa `23505` | Dobrze egzekwowany już dziś |
| I6 | Kształt front/back | Średnia | Średnie (3× zduplikowana identyczna funkcja) | Egzekwowany redundantnie (DB + app), spójnie |
| I7 | Kształt stanu FSRS | Niska (`ts-fsrs` to jawnie Generic subdomain, non-goal custom SRS — `prd.md:120`) | Średnie (dwie rozbieżne implementacje: `/review` ufa bezwarunkowo, `/review-reset` waliduje ręcznie) | Częściowy — realne ryzyko dopiero przy błędzie w bibliotece/jej aktualizacji |
| I8 | 30-dniowa karencja | Niska (nieobecne nawet w PRD) | Niskie (dwie implementacje tej samej stałej, ale spójne) | Egzekwowany, kosmetyczny problem |

### Wynik surowy vs. wybór faktyczny — jawny pivot

Zgodnie z regułą "wybierz niezmiennik najbardziej core I najsłabiej egzekwowany", **I1 wygrywa formalnie**
na obu osiach jednocześnie — dokładnie tak, jak ustaliła Destylacja (jej ranking #1). Nie kwestionuję tej
oceny: I1 rzeczywiście jest i najbardziej core, i najsłabiej egzekwowany ze wszystkich ośmiu.

Ale KROK 4 tego zadania wymaga **konkretnego rodzaju remedium**: agregatu-korzenia, repozytorium
ładującego/zapisującego jego stan, metod domenowych z preconditions, i (jeśli potrzeba) transakcji.
Ten wzorzec taktyczny DDD chroni **spójność trwałego stanu agregatu** między operacjami. I1 nie ma takiego
kształtu: nie ma trwałego stanu do ochrony (fiszka-propozycja nigdy nie jest zapisywana przed `accept`,
Destylacja już to ustaliła — "koncept domenowy, nietrwały" w `01-domain-distillation.md:75`), nie ma
przejścia stanu A→B do zablokowania, nie ma repozytorium do zbudowania — jest to funkcja czystego osądu
jakościowego (tekst → trafna klasyfikacja konceptów), wykonywana przez niedeterministyczny model. Właściwym
remedium dla I1 jest **harness ewaluacyjny** (złoty zestaw par input→oczekiwana-liczba-kart uruchamiany w
CI), nie agregat. Wymuszanie tu wzorca Aggregate/Repository byłoby sztuczne i nie rozwiązałoby realnego
problemu (jakości ekstrakcji), tylko opakowało go w fasadę, która niczego nie chroni.

**Wybieram więc I2+I3 (połączone) jako niezmiennik #1 do refaktoru w tym dokumencie**, z następującym
uzasadnieniem po tej samej siatce osi:
- (a) core: bezpośrednio w ścieżce ocenianej metryką sukcesu (accept/reject → zapis do talii) i wprost
  zadeklarowany guardrail (`prd.md:37,101`) — drugi najwyższy wynik rdzeniowości spośród ośmiu, i jedyny
  na tym poziomie core-ności, który jest **rzeczywiście kształtu "spójność trwałego stanu"**.
- (b) rozsmarowanie: najwyższe ze wszystkich ośmiu kandydatów — trzy rozbieżne implementacje tej samej
  reguły w trzech plikach (KROK 3).
- (c) egzekwowanie: pozornie "enforced" (DB nie pozwoli zapisać duplikatu), ale mechanizm ujawnia
  **aktywne łamanie innego zadeklarowanego niezmiennika (I3)** w jednej z trzech ścieżek — nie jest to
  hipotetyczne ryzyko, tylko odtwarzalny, dziś zakodowany w teście scenariusz (KROK 3).
- Efekt uboczny wybranego projektu: repozytorium zaprojektowane dla I2 naturalnie wzmacnia też **I4**
  (izolację właściciela) bez dodatkowego wysiłku — patrz KROK 4.

I1 pozostaje najwyższym priorytetem produktowym w sensie ryzyka biznesowego, ale to osobny problem
(ewaluacja jakości modelu), rekomendowany jako **oddzielna inicjatywa**, nie część tego refaktoru
architektonicznego. Rekomendacja jest zapisana w Podsumowaniu.

---

## KROK 3 — Diagnoza niezmiennika I2+I3

**Reguła:** W obrębie jednej talii nie mogą istnieć dwie karty o identycznym `(front, back)`, **oraz**
operacja zapisu zaakceptowanych przez użytkownika propozycji nie może cicho/niekontrolowanie utracić
kart, które nie kolidują z niczym.

### Gdzie dziś żyje reguła — wszystkie warstwy

**Warstwa DB (jedyne miejsce faktycznej gwarancji):**
```sql
create unique index cards_deck_id_front_back_hash_idx
  on cards (deck_id, (md5(front) || md5(back)));
```
`supabase/migrations/20260801114731_cards_unique_front_back.sql:5-6`. Indeks jest zbudowany na hashu
**surowego** tekstu — insert nigdzie nie trymuje `front`/`back` przed zapisem (`cards.ts:131`:
`front: card.front` bez `.trim()`), więc dwie karty różniące się tylko białymi znakami na końcu **nie**
zostaną wykryte jako duplikat, mimo że semantycznie są tą samą kartą. To osobna, mniejsza nieszczelność
tej samej reguły, wspomniana tu dla kompletności diagnozy.

**Warstwa app — ścieżka manualna (`POST /api/decks/[id]/cards/manual.ts`):**
```ts
if (error.code === "23505") {
  return new Response(
    JSON.stringify({ error: "A card with this exact front and back already exists in this deck" }),
    { status: 409, ... },
  );
}
```
`src/pages/api/decks/[id]/cards/manual.ts:66-74`. Poprawnie: łapie kod błędu Postgresa, zwraca czytelny
`409` z komunikatem domenowym. Klient (`GenerateFlashcardsPanel`) nie jest tu zaangażowany — to osobny
formularz.

**Warstwa app — ścieżka edycji (`PATCH /api/decks/[id]/cards/[cardId].ts`):**
Identyczna obsługa `23505` → `409` — `src/pages/api/decks/[id]/cards/[cardId].ts:68-76`. Spójna z manualną.

**Warstwa app — ścieżka bulk-AI (`POST /api/decks/[id]/cards.ts`), czyli dokładnie ścieżka accept-loop
mierzona metryką sukcesu produktu:**
```ts
const { data: saved, error } = await supabase.from("cards").insert(rows).select("front, back");

if (error) {
  return new Response(JSON.stringify({ error: error.message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
```
`src/pages/api/decks/[id]/cards.ts:133-140`. **Kod błędu `23505` nie jest w ogóle sprawdzany.** Cała
paczka insertów to jeden statement SQL — Postgres odrzuca ją atomowo, więc żadna karta się nie zapisuje,
ale użytkownik dostaje surowy komunikat błędu Postgresa (`error.message`, np. `duplicate key value
violates unique constraint "cards_deck_id_front_back_hash_idx"`) ze statusem **400**, nie **409** jak w
pozostałych dwóch ścieżkach — ten sam rodzaj konfliktu ma dwie różne semantyki HTTP w tym samym systemie.

**Warstwa klienta (`GenerateFlashcardsPanel.tsx`):** brak jakiejkolwiek wiedzy o regule. `handleSave()`
(`src/components/decks/GenerateFlashcardsPanel.tsx:124-161`) wysyła wszystkie zaakceptowane propozycje
jednym żądaniem (`acceptedProposals.map(...)`, linia 140) i na `!response.ok` po prostu wyświetla
`data.error` — czyli **surowy komunikat Postgresa** — bez wskazania, która konkretnie karta koliduje
(linia 149: `setSaveError(data.error ?? "Could not save the cards")`). Użytkownik, który zaakceptował
np. 12 z 15 propozycji, widzi nieczytelny błąd i traci **wszystkie 12** decyzji accept — musi zaczynać
przegląd od nowa. To jest dokładnie naruszenie I3 ("must never be silently lost on save") — nie jest to
cicha utrata (błąd jest widoczny), ale jest to utrata bez możliwości odzyskania i bez wskazania przyczyny
w sposób, który pozwoliłby użytkownikowi naprawić tylko problematyczny wiersz.

**Warstwa testów — reguła jest już skodyfikowana jako *oczekiwane* zachowanie:**
```ts
it("rejects the whole batch (400) and persists none of it when one row duplicates an existing card's front+back", async () => {
  ...
  expect(response.status).toBe(400);
  ...
  expect(countAfter).toBe(countBefore ?? 0);
});
```
`tests/integration/cards-batch-insert.test.ts:74-113`. Ten test nie jest luką w pokryciu — jest
**formalnym kontraktem, który zamraża dzisiejszy, wadliwy stan** (400 zamiast 409, brak informacji o
tym, która karta koliduje, brak jakiegokolwiek mechanizmu odzyskania). Każda zmiana zachowania w KROK 4
wymaga świadomej zmiany tego testu, nie tylko dopisania nowych przypadków — patrz KROK 5.

### Podsumowanie diagnozy

| Pytanie z brief | Odpowiedź |
|---|---|
| Które warstwy nie egzekwują reguły spójnie? | Ścieżka bulk-AI (`cards.ts`) nie mapuje `23505` na domenowy błąd w ogóle — jedyna z trzech ścieżek zapisu kart, która tego nie robi. |
| Gdzie jest egzekwowana niespójnie? | Manual/edit → `409` z czytelnym komunikatem; bulk-AI → `400` z surowym komunikatem DB. Ta sama reguła, dwie różne semantyki HTTP i UX. |
| Gdzie klient (UI) jest jedynym strażnikiem? | Nigdzie dla samej unikalności (DB zawsze jest ostatecznym strażnikiem) — ale dla **odzyskania po błędzie** (I3) UI jest jedynym miejscem, i dziś nie potrafi tego zrobić, bo backend nie mówi mu, który wiersz koliduje. |
| Gdzie błąd jest "połykany" zamiast zatrzymywać operację? | Nie jest połykany — przeciwnie, zatrzymuje *za dużo*: unieważnia cały batch, w tym wiersze niepowiązane z konfliktem, bez żadnej informacji zwrotnej pozwalającej naprawić tylko zły wiersz. To wariant tego samego antywzorca (błąd niekontrolowanie rozlewa się poza swój właściwy zakres). |

---

## KROK 4 — Projekt agregatu-strażnika

### Wybór korzenia agregatu

**`Deck`** jest korzeniem. Uzasadnienie: reguła unikalności jest zdefiniowana *per talia*
(`deck_id` jest częścią klucza unikalności w indeksie — `.../20260801114731_...sql:5-6`), więc tylko
instancja `Deck` zna pełny zbiór swoich kart potrzebny do samodzielnego sprawdzenia duplikatu — nie
wymaga to zapytania cross-agregatowego. `Card` jest encją podrzędną bez tożsamości/dostępu poza
kontekstem swojego `Deck` (zgodnie z ustaleniem Destylacji, `01-domain-distillation.md:67`).

Efekt uboczny projektu: skoro jedynym sposobem dotknięcia karty staje się wcześniejsze załadowanie
`Deck` przez repozytorium, a repozytorium **musi** filtrować po właścicielu żeby cokolwiek zwrócić —
niezmiennik I4 (izolacja właściciela) zyskuje egzekwowanie na poziomie aplikacji jako naturalna
konsekwencja, nie osobny wysiłek.

### Named domain errors

```
class DeckNotFoundError extends DomainError {
  // Rzucany zarówno gdy deckId nie istnieje, JAK i gdy istnieje ale należy do
  // innego użytkownika — te dwa przypadki muszą być nierozróżnialne z zewnątrz,
  // żeby nie ujawniać istnienia cudzych zasobów (uszczelnienie I4).
  constructor(deckId: string)
}

class InvalidCardFieldsError extends DomainError {
  constructor(field: "front" | "back", reason: "empty" | "too-long")
}

class DuplicateCardError extends DomainError {
  // duplicates: dokładnie te pary front/back, które kolidują — z pustej
  // odpowiedzi "duplicate key" użytkownik nie mógł się dowiedzieć, co naprawić.
  constructor(deckId: string, duplicates: Array<{ front: string; back: string; reason: "existing" | "within-batch" }>)
}

class CardNotFoundError extends DomainError {
  constructor(deckId: string, cardId: string)
}
```

### Card (encja, wartość dedup wyliczana identycznie jak DB)

```
class Card {
  readonly id: string
  readonly front: string
  readonly back: string
  readonly source: "ai" | "manual"

  static create(draft: { front: string; back: string }, source: "ai" | "manual"): Card {
    assertField("front", draft.front)
    assertField("back", draft.back)
    return new Card(newId(), draft.front, draft.back, source)
  }

  withFields(patch: { front: string; back: string }): Card {
    assertField("front", patch.front)
    assertField("back", patch.back)
    return new Card(this.id, patch.front, patch.back, this.source)
  }

  // Musi być bit-identyczne z wyrażeniem indeksu DB (md5(front) || md5(back)),
  // inaczej precondition w pamięci i constraint w bazie mogłyby się rozjechać.
  dedupKey(): string {
    return md5(this.front) + md5(this.back)
  }
}

function assertField(field: "front" | "back", value: string): void {
  if (value.trim().length === 0) throw new InvalidCardFieldsError(field, "empty")
  if (value.length > 2000) throw new InvalidCardFieldsError(field, "too-long")
}
```

### Deck (agregat, korzeń)

```
class Deck {
  readonly id: string
  readonly userId: string
  private cards: Map<string, Card>          // id -> Card
  private dedupIndex: Map<string, string>   // dedupKey -> card id

  // Wyłącznie do hydratacji przez repozytorium — nie omija preconditions,
  // bo dane z DB już przeszły przez CHECK constraints przy zapisie.
  static hydrate(row: DeckRow, cardRows: CardRow[]): Deck { ... }

  addCard(draft: { front: string; back: string }, source: "ai" | "manual"): Card {
    const card = Card.create(draft, source)
    this.assertNoDuplicate([card])
    this.cards.set(card.id, card)
    this.dedupIndex.set(card.dedupKey(), card.id)
    return card
  }

  // Precondition: KAŻDA propozycja w paczce musi być unikalna względem
  // istniejących kart ORAZ względem pozostałych propozycji w tej samej
  // paczce (dwie identyczne propozycje AI kolidowałyby ze sobą nawzajem
  // w tym samym INSERT-cie). Nielegalna paczka = zero mutacji stanu agregatu —
  // decyzja projektowa "wszystko albo nic" zachowuje semantykę, którą
  // tests/integration/cards-batch-insert.test.ts już dziś zakłada, tylko
  // czyni ją jawną i informacyjną zamiast surowego błędu DB.
  addCards(drafts: Array<{ front: string; back: string }>, source: "ai" | "manual"): Card[] {
    const candidates = drafts.map((d) => Card.create(d, source))
    this.assertNoDuplicate(candidates)
    candidates.forEach((c) => {
      this.cards.set(c.id, c)
      this.dedupIndex.set(c.dedupKey(), c.id)
    })
    return candidates
  }

  updateCard(cardId: string, patch: { front: string; back: string }): Card {
    const existing = this.cards.get(cardId)
    if (!existing) throw new CardNotFoundError(this.id, cardId)
    const updated = existing.withFields(patch)
    this.assertNoDuplicate([updated], cardId)
    this.dedupIndex.delete(existing.dedupKey())
    this.cards.set(cardId, updated)
    this.dedupIndex.set(updated.dedupKey(), cardId)
    return updated
  }

  removeCard(cardId: string): void {
    const existing = this.cards.get(cardId)
    if (!existing) throw new CardNotFoundError(this.id, cardId)
    this.cards.delete(cardId)
    this.dedupIndex.delete(existing.dedupKey())
  }

  private assertNoDuplicate(candidates: Card[], excludeCardId?: string): void {
    const seenInBatch = new Map<string, Card>()
    const duplicates: Array<{ front: string; back: string; reason: "existing" | "within-batch" }> = []

    for (const candidate of candidates) {
      const key = candidate.dedupKey()
      const owner = this.dedupIndex.get(key)
      if (owner !== undefined && owner !== excludeCardId) {
        duplicates.push({ front: candidate.front, back: candidate.back, reason: "existing" })
      } else if (seenInBatch.has(key)) {
        duplicates.push({ front: candidate.front, back: candidate.back, reason: "within-batch" })
      }
      seenInBatch.set(key, candidate)
    }

    if (duplicates.length > 0) throw new DuplicateCardError(this.id, duplicates)
  }
}
```

### Repozytorium

```
class DeckRepository {
  // Ownership sprawdzany TUTAJ (.eq("user_id", ownerId)), nie tylko przez RLS —
  // wzmacnia I4 jako produkt uboczny, bez osobnego zadania.
  async load(deckId: string, ownerId: string): Promise<Deck> {
    const deckRow = await db.from("decks").select("*").eq("id", deckId).eq("user_id", ownerId).maybeSingle()
    if (!deckRow) throw new DeckNotFoundError(deckId)
    const cardRows = await db.from("cards").select("*").eq("deck_id", deckId)
    return Deck.hydrate(deckRow, cardRows)
  }

  // Jeden `insert` z wieloma wierszami jest już atomowy na poziomie Postgresa
  // (all-or-nothing) — nie potrzeba tu RPC/transakcji wielo-statementowej.
  // DB unique index zostaje jako ostateczny strażnik na wypadek wyścigu
  // (dwa równoległe żądania przechodzą precondition w pamięci, zanim
  // którekolwiek zapisze) — 23505, który mimo to przejdzie, jest mapowany
  // na TEN SAM DuplicateCardError, więc API nigdy nie widzi surowego kodu DB.
  async saveNewCards(deck: Deck, cards: Card[]): Promise<void> {
    const { error } = await db.from("cards").insert(cards.map(toRow(deck.id)))
    if (error?.code === "23505") throw new DuplicateCardError(deck.id, toDuplicatePairs(cards, error))
    if (error) throw new PersistenceError(error)
  }

  async saveUpdatedCard(deck: Deck, card: Card): Promise<void> {
    const { error } = await db.from("cards").update(toRow(deck.id)(card)).eq("id", card.id).eq("deck_id", deck.id)
    if (error?.code === "23505") throw new DuplicateCardError(deck.id, [{ front: card.front, back: card.back, reason: "existing" }])
    if (error) throw new PersistenceError(error)
  }

  async removeCard(deck: Deck, cardId: string): Promise<void> {
    const { error } = await db.from("cards").delete().eq("id", cardId).eq("deck_id", deck.id)
    if (error) throw new PersistenceError(error)
  }
}
```

### Cienkie API (przykład: bulk-accept, dziś `cards.ts:92-158`)

```
export const POST: APIRoute = async (context) => {
  requireAuth(context)                                   // -> 401
  const input = parseAndValidateShapeOnly(context)        // -> 400, tylko parsowanie JSON, nie reguły domenowe

  try {
    const deck = await repo.load(context.params.id, context.locals.user.id)   // DeckNotFoundError -> 404
    const cards = deck.addCards(input.cards, "ai")                            // InvalidCardFieldsError -> 400
                                                                                // DuplicateCardError -> 409
    await repo.saveNewCards(deck, cards)                                       // DuplicateCardError (wyścig) -> 409
    return json({ saved: cards }, 200)
  } catch (err) {
    return mapDomainErrorToResponse(err)   // JEDNO miejsce mapowania błędów -> odpowiedź, używane przez
                                            // wszystkie trzy endpointy (cards.ts, manual.ts, [cardId].ts)
  }
}
```

`mapDomainErrorToResponse` eliminuje rozjazd z KROK 3: `DuplicateCardError` zawsze daje `409` z listą
kolidujących par, niezależnie od tego, którym endpointem przyszła. Egzekucja reguły przenosi się z
"czy dany endpoint akurat złapał `23505`" na "agregat odmawia nielegalnej mutacji, zanim cokolwiek
dotknie DB".

---

## KROK 5 — Before/after, plan faz, testy

### Before/after

| Miejsce dziś | Dziś | Po refaktorze |
|---|---|---|
| `cards.ts:133-140` (bulk-AI) | Brak obsługi `23505`; surowy `error.message`, status `400`; cała paczka ginie bez wskazania winowajcy | `DuplicateCardError` → `409` z listą kolidujących par; paczka wciąż odrzucana atomowo, ale z informacją pozwalającą klientowi odznaczyć tylko złą propozycję |
| `cards/manual.ts:66-74` | Ręczna obsługa `23505` → `409`, ale logika duplikowana z pozostałych dwóch plików | Ta sama ścieżka co bulk-AI i edycja: `deck.addCard()` + wspólny `mapDomainErrorToResponse` |
| `cards/[cardId].ts:68-76` | Jak wyżej | `deck.updateCard()`, wspólne mapowanie błędu |
| `cards.ts`, `manual.ts`, `[cardId].ts` — `isValidCardInput` (3× identyczna kopia, linie 9-20 w każdym) | Trzy niezależne kopie tej samej funkcji | Jedna implementacja: `assertField` wewnątrz `Card.create`/`withFields` |
| Brak filtra właściciela w żadnym z ww. endpointów | Poleganie wyłącznie na RLS | `DeckRepository.load(id, ownerId)` — ownership sprawdzony w aplikacji, RLS zostaje jako druga warstwa |
| `GenerateFlashcardsPanel.tsx:148-150` | `setSaveError(data.error ?? ...)` pokazuje surowy tekst błędu DB | Backend zwraca `{ error, duplicates: [...] }`; UI może podświetlić dokładnie kolidujące propozycje (zmiana UI poza zakresem tego dokumentu — tylko kontrakt odpowiedzi się zmienia) |

### Plan faz

Projekt ma dyscyplinę testową (Vitest, `tests/integration/`) — fazy 2-4 idą **test-first**: najpierw
zmienić/dopisać test tak, by opisywał docelowy kontrakt i failował na dzisiejszym kodzie, dopiero potem
implementować.

1. **Faza 0 (bez zmian w kodzie).** Ten dokument. Decyzja do potwierdzenia z użytkownikiem: zachowanie
   "wszystko albo nic" dla `addCards` (zgodne z dzisiejszym testem) vs. "zapisz nie-kolidujące, zgłoś
   pominięte" (zmiana semantyki, większa zmiana UI). Projekt w KROK 4 zakłada wariant "wszystko albo nic",
   bo to najmniejsza zmiana zachowania spójna z I3 rozumianym jako "błąd musi być czytelny i naprawialny",
   a nie "system sam decyduje co zapisać".
2. **Faza 1 — `Card` i `Deck` jako czyste klasy domenowe**, bez dotykania route'ów. Test-first:
   testy jednostkowe dla `Card.create`, `Deck.addCard`, `Deck.addCards`, `Deck.updateCard`,
   `Deck.removeCard` — patrz przypadki testowe niżej. Zero zależności od Supabase.
3. **Faza 2 — `DeckRepository`.** Test-first (integracyjne, wzorem `tests/integration/`): `load()` zwraca
   `DeckNotFoundError` dla cudzej talii (dziś nie ma takiego testu — trzeba dopisać, bo dziś to zachowanie
   nigdy nie jest weryfikowane wprost, tylko domyślnie wynika z RLS), `saveNewCards()` mapuje wyścigowy
   `23505` na `DuplicateCardError`.
4. **Faza 3 — przepięcie `cards.ts`, `cards/manual.ts`, `cards/[cardId].ts` na agregat.** Najpierw
   **zmienić** `tests/integration/cards-batch-insert.test.ts:74-113` — dziś asercjuje `400` i brak treści
   błędu; docelowo musi asercjonować `409` oraz obecność `duplicates` w body wskazującego dokładnie
   kolidujący wiersz. Dopiero po czerwonym teście podmienić handler.
5. **Faza 4 — `mapDomainErrorToResponse` jako wspólny moduł**, użyty przez wszystkie trzy endpointy;
   usunięcie trzech kopii `isValidCardInput`.
6. **Faza 5 (opcjonalna, poza głównym zakresem).** Aktualizacja `GenerateFlashcardsPanel.tsx`, by
   wykorzystać `duplicates` z odpowiedzi do podświetlenia tylko kolidujących propozycji zamiast
   wyświetlania surowego tekstu błędu.

### Przypadki testowe dla niezmiennika (legalne i nielegalne)

**Legalne:**
1. `addCard` z unikalnym front/back → karta dodana, `source` zgodny z wywołującym.
2. `addCards` z propozycjami wzajemnie unikalnymi i nie kolidującymi z istniejącymi → wszystkie dodane.
3. `updateCard` zmieniający front/back na inną, wciąż unikalną parę → sukces.
4. `updateCard` "zmieniający" front/back na dokładnie te same wartości, które karta już ma → sukces (brak
   fałszywego alarmu o kolizji z samą sobą — pokrywa `excludeCardId` w `assertNoDuplicate`).
5. `removeCard`, a następnie `addCard` z front/back identycznym jak usunięta karta → sukces (zwolniony slot
   w `dedupIndex`).

**Nielegalne (zero mutacji stanu agregatu, nazwany błąd domenowy):**
6. `addCard` z front/back już istniejącym w talii → `DuplicateCardError(reason: "existing")`.
7. `addCards`, gdzie jedna z N propozycji koliduje z istniejącą kartą → `DuplicateCardError`; **żadna**
   z N propozycji nie zostaje zapisana, w tym te niepowiązane z konfliktem (odtwarza dzisiejszy test
   `cards-batch-insert.test.ts`, ale z czytelnym błędem zamiast surowego).
8. `addCards`, gdzie dwie propozycje w tej samej paczce są identyczne wobec siebie (żadna nie koliduje z
   istniejącymi) → `DuplicateCardError(reason: "within-batch")` — dziś **nieprzetestowany** przypadek;
   DB constraint by to złapał, ale ścieżka bulk-AI nawet by tego nie zauważyła (patrz KROK 3).
9. `updateCard` zmieniający front/back tak, by kolidowały z **inną** istniejącą kartą w tej samej talii →
   `DuplicateCardError`, oryginalna karta niezmieniona.
10. `addCard`/`addCards`/`updateCard` z front lub back pustym po trim lub >2000 znaków →
    `InvalidCardFieldsError`, zero mutacji.
11. `DeckRepository.load(deckId, ownerId)` dla talii istniejącej, ale należącej do innego użytkownika →
    `DeckNotFoundError` (nie osobny "403" — nie potwierdzamy cudzym użytkownikom istnienia zasobu).
12. Symulowany wyścig: dwa równoległe wywołania `saveNewCards` dla tej samej nowej pary front/back, oba
    przechodzą precondition w pamięci (stan sprzed zapisu drugiego) → drugi zapis dostaje `23505` z
    Postgresa → repozytorium mapuje go na `DuplicateCardError`, nie na surowy błąd/500.

### Nowe nazwy "load-bearing" do zarejestrowania

Projekt nie prowadzi dziś żadnego rejestru kontraktów (brak takiego pliku w `context/foundation/`) —
poniższa lista to rekomendacja startowa, gdyby taki rejestr powstał:
- `Deck` (agregat, korzeń) — jedyne miejsce mutacji kolekcji `Card` w obrębie talii.
- `DeckRepository.load(deckId, ownerId)` — jedyny legalny sposób uzyskania instancji `Deck`; ownership
  jest częścią kontraktu, nie efektem ubocznym RLS.
- `DuplicateCardError`, `InvalidCardFieldsError`, `CardNotFoundError`, `DeckNotFoundError` — jedyny
  słownik błędów domenowych dla operacji na kartach; żaden endpoint nie powinien już zwracać surowego
  `error.message` z Supabase dla tych ścieżek.
- `mapDomainErrorToResponse` — jedyne miejsce tłumaczenia błędu domenowego na kod HTTP.

---

## Podsumowanie

Zidentyfikowano osiem niezmienników biznesowych rozsianych po prompcie LLM, bazie danych, RLS,
middleware i cronie, i oceniono je na trzech osiach (core-ność, rozsmarowanie, egzekwowanie). Formalnie
najbardziej core i najsłabiej egzekwowany jest niezmiennik "brak konceptów → zero propozycji" (`prd.md:112`) —
zgodnie z rankingiem z Destylacji — ale świadomie **odrzucam go jako cel tego konkretnego refaktoru**,
bo nie ma kształtu "spójność trwałego stanu agregatu": nie ma czego chronić repozytorium ani transakcją,
tylko jakość osądu niedeterministycznego modelu, dla której właściwym remedium jest harness ewaluacyjny w
CI, nie wzorzec Aggregate/Repository — i to jest rekomendowane jako osobna inicjatywa. Do refaktoru w tym
dokumencie wybrano połączony niezmiennik "unikalność karty w obrębie talii + brak utraty zaakceptowanych
danych przy zapisie" — bezpośrednio w ścieżce ocenianej metryką sukcesu produktu (75% acceptance),
dziś zaimplementowany trzykrotnie w rozbieżny sposób (`cards.ts`, `cards/manual.ts`, `cards/[cardId].ts`),
z jedną ścieżką (bulk-AI, czyli dokładnie ścieżkę accept-loop) w ogóle nie obsługującą konfliktu i
niszczącą wszystkie zaakceptowane przez użytkownika decyzje naraz — zachowanie dziś formalnie
zakodowane jako oczekiwane w `tests/integration/cards-batch-insert.test.ts:74-113`. Zaprojektowano
agregat `Deck` jako jedyne miejsce mutacji kart, z metodami domenowymi rzucającymi nazwane błędy
(`DuplicateCardError`, `InvalidCardFieldsError`, `CardNotFoundError`), repozytorium `DeckRepository`
ładujące talię wyłącznie dla jej właściciela (co przy okazji wzmacnia niezależnie zidentyfikowany
niezmiennik izolacji danych między użytkownikami) i zapisujące zmiany atomowo z DB unique index jako
ostatecznym strażnikiem przed wyścigami. Plan faz jest test-first i zaczyna od świadomej zmiany
istniejącego testu, który dziś asercjuje wadliwe zachowanie jako kontrakt.
