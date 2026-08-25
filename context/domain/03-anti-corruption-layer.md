---
title: "Plan refaktoru: warstwa anty-korupcyjna (ACL) dla ts-fsrs — 10xFiszki"
created: 2026-08-24
type: refactor-plan
---

# Plan refaktoru: Anti-Corruption Layer dla `ts-fsrs`

Ten dokument jest **planem**, nie implementacją. Nie modyfikuje kodu produkcyjnego. Jest niezależny od
`02-invariant-aggregate-refactor.md` (dalej: "Doc 02") — dotyczy innej osi problemu (przeciek zależności
zewnętrznej przez granice warstw, nie spójność stanu agregatu) i można go realizować w dowolnej kolejności
względem Doc 02. Punkt styku obu dokumentów jest odnotowany w KROK 4.

## KROK 0 — Odkryty kontekst

Przeczytane bezpośrednio na potrzeby tego dokumentu (część już zweryfikowana w Doc 01/02, ponownie
zacytowana tu, gdzie istotna): `package.json`, `astro.config.mjs`, `src/lib/fsrs.ts`, `src/lib/supabase.ts`,
`src/pages/api/decks/[id]/review.ts`, `src/pages/api/decks/[id]/review-reset.ts`,
`src/components/decks/ReviewSessionPanel.tsx`, `tests/unit/fsrs.test.ts`,
`context/archive/2026-08-01-spaced-repetition-review-session/srs-library-research.md`, `context/foundation/prd.md`.

**Manifest zależności zewnętrznych** (`package.json:17-39`, sekcja `dependencies` — czyli pakiety, które
bundler może w zasadzie umieścić w dowolnym z trzech runtime'ów: Cloudflare Worker SSR, przeglądarka
klienta React, lub obu):
`@astrojs/*`, `@radix-ui/react-slot`, `@supabase/ssr`, `@supabase/supabase-js`, `astro`,
`class-variance-authority`, `clsx`, `lucide-react`, `react`, `react-dom`, `tailwind-merge`, `tailwindcss`,
**`ts-fsrs`**, `tw-animate-css`.

**Warstwy kodu:** `src/pages/api/**` (API — cienkie handlery Astro), `src/pages/**.astro` (SSR strony),
`src/components/**` (UI — React, część `client:load` czyli wysyłana i uruchamiana w przeglądarce),
`src/lib/**` (dzielona logika pomocnicza, importowana zarówno przez `pages/api` jak i przez `components` —
katalog ten **nie ma dziś żadnej deklarowanej granicy "tylko-serwer"**, w przeciwieństwie do zmiennych
środowiskowych).

**Precedens w tym samym repo, który dowodzi, że zespół umie egzekwować granicę serwer/klient, gdy o niej
pamięta:** `astro.config.mjs:19-21` deklaruje `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY` jako
`envField.string({ context: "server", ... })` — narzędziowo wymuszona gwarancja, że te wartości nigdy nie
trafią do bundla klienta (potwierdzone też w `CLAUDE.md`: "they are not available in client-side code").
Ten mechanizm istnieje wyłącznie dla zmiennych środowiskowych — **nie ma żadnego analogicznego mechanizmu
ani konwencji dla pakietów npm**, więc nic nie ostrzega, gdy cały pakiet (nie tylko sekret) przekracza tę
samą granicę.

**Deklaracja intencji wymienialności — dwa niezależne dokumenty:**
- `prd.md:94` (FR-014): "User can rate their recall on each card during a review session (scheduling
  **delegated to a third-party SRS service**)."
- `prd.md:120` (Non-Goals): "No custom SRS algorithm. Scheduling is fully **delegated to a third-party SRS
  service**. No SM-2, FSRS, or equivalent algorithm is implemented in this codebase. Rationale: building
  and tuning a spaced repetition algorithm is a separate domain problem; **third-party services are
  battle-tested**."
- `prd.md:128` (Open Question #1, rozstrzygnięcie): "self-hosted `ts-fsrs` library (FSRS v6), not a hosted
  third-party API... this resolution means FR-014's 'scheduling delegated to a third-party SRS service'
  wording **no longer precisely matches the implementation approach** (self-hosted, not delegated) —
  flagged here rather than silently rewritten."
- `context/archive/2026-08-01-spaced-repetition-review-session/srs-library-research.md:33`: "**Card
  scheduling state is computed server-side** and persisted in our own `cards` rows (Supabase) — no review
  data leaves our infrastructure."

Wspólny mianownik obu dokumentów: silnika planowania powtórek **nie należy traktować jak zwykłej
biblioteki narzędziowej wciąganej gdziekolwiek jest wygodnie** — ma być ukryty za granicą usługi (PRD) i ma
być obliczeniem po stronie serwera (decyzja techniczna). KROK 3 pokazuje, że kod tego nie dotrzymuje.

---

## KROK 1 — Zidentyfikowane przeciekające zależności

### Kandydat A: `ts-fsrs`

Wszystkie pliki, które dziś "znają" ten pakiet (bezpośredni `import` lub — dla `review-reset.ts` —
odtworzenie jego kształtu danych bez importu):

| Plik:linia | Co robi | Warstwa |
|---|---|---|
| `src/lib/fsrs.ts:1` | `import { fsrs, generatorParameters, type Card } from "ts-fsrs"` | lib (dzielona) |
| `src/lib/fsrs.ts:6` | `export const scheduler = fsrs(generatorParameters({ enable_short_term: false }))` — jedna instancja silnika | lib |
| `src/lib/fsrs.ts:8-20` | `FsrsFields` — ręczna rekonstrukcja kształtu wiersza DB pod kątem `ts-fsrs` | lib |
| `src/lib/fsrs.ts:22-35`, `37-62` | `toFsrsCard` / `fromFsrsCard` — konwersja wiersz DB ↔ typ biblioteki `Card` | lib |
| `src/pages/api/decks/[id]/review.ts:3` | `import { scheduler, toFsrsCard, fromFsrsCard } from "@/lib/fsrs"` | API |
| `src/pages/api/decks/[id]/review.ts:51-59` | `GET` zwraca surowe kolumny FSRS wprost z `select(...)`, bez DTO | API (kontrakt wire) |
| `src/pages/api/decks/[id]/review.ts:68-71` | `return new Response(JSON.stringify({ cards }))` — `cards` to niezmieniony wynik zapytania SQL | API (kontrakt wire) |
| `src/pages/api/decks/[id]/review.ts:129` | `scheduler.next(toFsrsCard(row), now, body.grade)` — `body.grade` to surowy `number` z requestu, zakładający zgodność z enumem biblioteki `Rating`/`Grade` (1-4) | API |
| `src/pages/api/decks/[id]/review-reset.ts:6-18` | `ResetCardInput` — **trzecia**, niezależna, ręczna rekonstrukcja dokładnie tych samych 10 pól FSRS (nie re-używa `FsrsFields`) | API |
| `src/pages/api/decks/[id]/review-reset.ts:28-60` | `isValidResetCard` — walidacja pole-po-polu z **własną** semantyką (`isNonNegativeFiniteNumber`), rozbieżną z tym, co `toFsrsCard`/DB CHECK egzekwują | API |
| `src/components/decks/ReviewSessionPanel.tsx:3` | `import { fsrs, generatorParameters, Rating, type Grade } from "ts-fsrs"` — **import pakietu bezpośrednio w komponencie React `client:load`** | UI (przeglądarka) |
| `src/components/decks/ReviewSessionPanel.tsx:9` | `import { toFsrsCard, type FsrsFields } from "@/lib/fsrs"` — komponent kliencki importuje moduł `src/lib/fsrs.ts`, który z kolei importuje `ts-fsrs` — pakiet trafia do bundla klienta tranzytywnie nawet gdyby linia 3 nie istniała | UI |
| `src/components/decks/ReviewSessionPanel.tsx:25-70` | `RATING_BUTTONS` kluczowane wprost enumem `Rating.Again/Hard/Good/Easy` z biblioteki | UI |
| `src/components/decks/ReviewSessionPanel.tsx:106` | `useState<Partial<Record<Grade, Date>> | null>` — typ stanu komponentu zależny od typu biblioteki | UI |
| `src/components/decks/ReviewSessionPanel.tsx:116` | `useRef(fsrs(generatorParameters({ enable_short_term: false })))` — **druga, niezależna instancja silnika**, z identyczną konfiguracją zapisaną osobno | UI |
| `src/components/decks/ReviewSessionPanel.tsx:196` | `localSchedulerRef.current.repeat(toFsrsCard(currentCard), new Date())` — **wykonanie biblioteki FSRS w przeglądarce** | UI |
| `src/components/decks/ReviewSessionPanel.tsx:206,235` | `async function rate(grade: Grade)` → `body: JSON.stringify({ cardId, grade })` — wartość typu biblioteki trafia bezpośrednio do body żądania HTTP | UI → kontrakt wire |
| `tests/unit/fsrs.test.ts:2` | `import { fsrs, generatorParameters, State } from "ts-fsrs"` | testy (poza zakresem "produkcja", ale potwierdza brak jednego punktu wejścia) |

**Sygnały z brief, wszystkie spełnione jednocześnie:**
- Ten sam pakiet importowany w wielu warstwach (lib **+** API **+** UI) — jedyny kandydat w repo, który to
  robi.
- Zduplikowana rekonstrukcja obiektu biblioteki w kilku miejscach: instancja `fsrs(generatorParameters(...))`
  budowana niezależnie w `fsrs.ts:6` i `ReviewSessionPanel.tsx:116` z tą samą konfiguracją zapisaną jako
  osobny literał w dwóch plikach (nic nie gwarantuje, że pozostaną zsynchronizowane, gdyby ktoś zmienił
  jeden z nich).
- Zduplikowana rekonstrukcja **kształtu danych** biblioteki: `FsrsFields` (`fsrs.ts:8-20`) vs `ResetCardInput`
  (`review-reset.ts:6-18`) — te same 10 pól, dwie niezależne definicje typu i dwie niezależne walidacje.
- Typy/wartości biblioteki w kontrakcie wire: `grade: Grade` w body żądania POST (`ReviewSessionPanel.tsx:206`),
  surowe kolumny FSRS w odpowiedzi GET (`review.ts:51-59,68-71`).
- Ta sama biblioteka wołana po obu stronach granicy klient/serwer: `scheduler.next()` po stronie serwera
  (`review.ts:129`) i `localSchedulerRef.current.repeat()` po stronie przeglądarki
  (`ReviewSessionPanel.tsx:196`) — dosłownie ten sam pakiet npm uruchamiany w dwóch różnych runtime'ach.

### Kandydat B: `@supabase/supabase-js` / `@supabase/ssr` (odrzucony w KROK 2, dla kontrastu)

Zweryfikowane grep: pakiet importowany **wyłącznie** w `src/lib/supabase.ts:1,3` (plus typy w
`src/env.d.ts` i pomocnikach testowych — poza warstwą produkcyjnego UI/API runtime). Żaden plik w
`src/components/**` go nie importuje. Owszem, klient jest wołany bezpośrednio (`supabase.from("cards")...`)
w ~10 plikach API (`cards.ts`, `manual.ts`, `[cardId].ts`, `decks/index.ts`, `delete.ts`, `generate.ts`,
`review.ts`, `review-reset.ts`) — to jest realny przeciek, ale **w obrębie jednej warstwy** (API → DB), nigdy
przez granicę serwer/klient. To już jest zdiagnozowane pośrednio w Doc 02 (propozycja `DeckRepository`) jako
problem duplikacji zapytań, nie jako przeciek międzywarstwowy.

### Kandydat C: `openrouter` (klient LLM)

`src/lib/openrouter.ts` + `src/pages/api/decks/[id]/generate.ts` + `src/lib/config-status.ts`. Wyłącznie
warstwa API/lib, brak importu w żadnym komponencie React, klient przeglądarki komunikuje się z tym
mechanizmem tylko przez `fetch("/api/decks/[id]/generate")` — zero przecieku. Odrzucony jako nieistotny.

---

## KROK 2 — Klasyfikacja i wybór #1

| Oś | `ts-fsrs` | `@supabase/supabase-js` |
|---|---|---|
| (a) Liczba warstw/plików dotkniętych | **3 warstwy**: lib, API, UI-w-przeglądarce — jedyny pakiet w repo importowany po obu stronach granicy klient/serwer; 4 pliki produkcyjne + duplikacja kształtu w 2 niezależnych definicjach typu | 1 warstwa (API→DB), ~10 plików, ale zero przecieku do UI |
| (b) Ryzyko/koszt wymiany dziś | Wymiana silnika wymagałaby zmiany: schematu DB (nazwy kolumn `stability/difficulty/elapsed_days/scheduled_days/learning_steps/lapses/state` są nazwane wprost pod kątem FSRS — `supabase/migrations/20260801130000_cards_fsrs_fields.sql`), **dwóch** endpointów API, **i** logiki renderowania UI (`RATING_BUTTONS`, podgląd interwałów) — całościowa przebudowa stosu, nie jednego modułu | Wymiana wymagałaby przepisania ~10 plików API, ale zero zmian w UI (UI zna tylko JSON przez HTTP) — koszt wysoki, ale zamknięty w jednej warstwie |
| (c) Dokumenty deklarują wymienialność? | **Tak, dwukrotnie, niezależnie**: PRD (`prd.md:94,120,128` — "delegated to a third-party SRS service", explicit Non-Goal) i decyzja techniczna (`srs-library-research.md:33` — "computed server-side... no review data leaves our infrastructure"). Rozjazd intencja-vs-kod jest udokumentowany przez sam projekt (`prd.md:128` sam to flaguje) | **Nie** — `tech-stack.md:24` wybiera Supabase jako trwały, nieplanowany-do-wymiany fundament ("Supabase delivers auth and Postgres out of the box") |

**Wybieram `ts-fsrs` jako niezmiennik/zależność #1.** Wygrywa na wszystkich trzech osiach jednocześnie, a oś
(c) jest tu najsilniejsza: to jedyny kandydat, dla którego **dwa niezależne dokumenty** (PRD i osobna notatka
decyzyjna) wprost deklarują, że mechanizm ma być zamknięty za granicą usługi/serwera, podczas gdy kod
dosłownie przenosi tę samą bibliotekę do przeglądarki. `@supabase/supabase-js` ma większą liczbę plików, ale
nigdy nie przekracza granicy klient/serwer i żaden dokument nie deklaruje dla niego wymienialności — to inny
rodzaj problemu (duplikacja zapytań w jednej warstwie), już adresowany w Doc 02.

---

## KROK 3 — Diagnoza

### Niebezpieczny przeciek: biblioteka serwerowa w bundlu klienta

`ts-fsrs` jest w `package.json:37` sekcji `dependencies` (nie `devDependencies`), a
`src/components/decks/ReviewSessionPanel.tsx` jest komponentem React renderowanym z `client:load` (jedyny
sposób, w jaki interaktywne komponenty tego stosu trafiają do przeglądarki — patrz `CLAUDE.md`, "form
components are client-only (`client:load`)"). Import na `ReviewSessionPanel.tsx:3`:

```ts
import { fsrs, generatorParameters, Rating, type Grade } from "ts-fsrs";
```

oznacza, że cały silnik FSRS (algorytm, nie tylko typy — `fsrs()` i `generatorParameters()` to wołania
runtime'owe, linia 116) jest wliczony do bundla wysyłanego do przeglądarki i **faktycznie wykonywany
lokalnie** (`ReviewSessionPanel.tsx:196`, `.repeat()`) do wyliczenia podglądu czterech możliwych dat `due`
przed wyborem oceny przez użytkownika. Dzieje się to mimo że:

- decyzja techniczna wprost mówi: "Card scheduling state is **computed server-side**... no review data
  leaves our infrastructure" (`srs-library-research.md:33`) — podgląd jest *obliczeniem tego samego rodzaju*
  (scheduling), tylko nie zapisywanym; dokument nie robi tego rozróżnienia i literalnie zaprzecza temu, co
  faktycznie się dzieje w przeglądarce.
- PRD explicite każe traktować cały mechanizm jako coś, co powinno dać się **wymienić bez wpływu na resztę
  systemu** ("delegated to a third-party SRS service" — `prd.md:94,120`). Dziś wymiana `ts-fsrs` wymaga
  dotknięcia UI, nie tylko backendu.
- `astro.config.mjs:19-21` pokazuje, że projekt **ma** narzędzie do wymuszania granicy serwer/klient
  (`context: "server"` dla zmiennych środowiskowych) — po prostu nie zostało zastosowane koncepcyjnie do
  tej zależności, bo to nie jest sekret, tylko cały pakiet z logiką.

### Zduplikowana konstrukcja tej samej instancji silnika

```ts
// src/lib/fsrs.ts:6
export const scheduler = fsrs(generatorParameters({ enable_short_term: false }));
```
```tsx
// src/components/decks/ReviewSessionPanel.tsx:116
const localSchedulerRef = useRef(fsrs(generatorParameters({ enable_short_term: false })));
```

Identyczny wywołanie z identycznym argumentem, w dwóch plikach, bez współdzielonej stałej. Komentarz
wyjaśniający *dlaczego* `enable_short_term: false` (`fsrs.ts:4-5`: "skips the minutes-scale (re)learning
steps, so every rating... produces a day-scale interval") istnieje **tylko przy jednej z dwóch kopii** — gdyby
ktoś zmienił konfigurację w `fsrs.ts` (np. przy przyszłym dostrajaniu parametrów), podgląd w UI po cichu
przestałby odpowiadać rzeczywistemu zachowaniu serwera, bo nic nie synchronizuje tych dwóch literałów.

### Potrójna, rozbieżna rekonstrukcja kształtu "karta FSRS"

| Miejsce | Definicja pól | Walidacja |
|---|---|---|
| `src/lib/fsrs.ts:8-20` (`FsrsFields`) | `Pick<Tables<"cards">, "due"\|"stability"\|...>` — 10 pól, wywiedzione z wygenerowanego typu DB | Brak własnej — ufa, że wiersz z DB już przeszedł CHECK constraints |
| `src/pages/api/decks/[id]/review-reset.ts:6-18` (`ResetCardInput`) | Ręcznie wypisane te same 10 pól, **nie** re-używa `FsrsFields` | `isValidResetCard` (linie 28-60) — własna semantyka: `isNonNegativeFiniteNumber` dla 7 pól numerycznych, `isValidDateString` dla 2 pól dat, zakres 0-3 dla `state` |
| `src/components/decks/ReviewSessionPanel.tsx:213-224` (obiekt w `ratedSnapshots`) | Ręcznie wypisane te same 10 pól po raz trzeci (typowane jako `FsrsFields`, ale skonstruowane przez wyliczenie pól, nie `{ ...currentCard }`) | Brak — pola przepisywane 1:1 z odpowiedzi GET |

Trzy niezależne miejsca muszą pozostać zgodne co do tego, "z jakich dokładnie 10 pól składa się stan FSRS
karty" — nic tego nie wymusza na poziomie typów (poza tym, że `FsrsFields` i `ResetCardInput` przypadkiem
mają te same nazwy pól). Gdyby `ts-fsrs` dodał/zmienił pole w przyszłej wersji (biblioteka jest aktywnie
rozwijana — `package.json:37` wskazuje `^5.4.1`), trzeba by pamiętać o synchronizacji trzech miejsc ręcznie.

### Typ biblioteki w kontrakcie wire (HTTP)

`POST /api/decks/[id]/review` przyjmuje body `{ cardId: string; grade: number }`, gdzie `grade` musi
odpowiadać wartościom enuma `Rating` z `ts-fsrs` (1-4) — po stronie klienta funkcja wysyłająca to żądanie
jest jawnie otypowana jako `async function rate(grade: Grade)` (`ReviewSessionPanel.tsx:206`), gdzie `Grade`
jest importowany wprost z `ts-fsrs` (linia 3). Kontrakt HTTP tej aplikacji jest więc dosłownie zdefiniowany
typem biblioteki zewnętrznej, nie własnym typem domenowym. Analogicznie `GET /api/decks/[id]/review`
(`review.ts:51-59,68-71`) zwraca surowy wynik `select(...)` bez żadnego DTO — kształt odpowiedzi HTTP jest
identyczny z nazwami kolumn tabeli `cards`, które z kolei istnieją w tym kształcie **tylko po to**, by
pasować do interfejsu `Card` z `ts-fsrs` (`toFsrsCard`/`fromFsrsCard` w `fsrs.ts:22-62` to round-trip
dokładnie temu służący). Klient (`ReviewCard` typ, `ReviewSessionPanel.tsx:12`) odtwarza ten sam kształt
raz jeszcze przez `Pick<Tables<"cards">, ...> & FsrsFields`.

### Podsumowanie diagnozy

| Pytanie z brief | Odpowiedź |
|---|---|
| Który pakiet przecieka przez granice warstw? | `ts-fsrs` — jedyny w repo importowany jednocześnie w `lib`, `API` i komponencie `client:load` |
| Gdzie jest to najbardziej niebezpieczne? | Przeglądarka wykonuje silnik FSRS lokalnie (`ReviewSessionPanel.tsx:116,196`) mimo dwóch niezależnych dokumentów deklarujących, że scheduling ma być serwerowy/wymienialny |
| Gdzie jest zduplikowana rekonstrukcja? | Instancja silnika (2×: `fsrs.ts:6`, `ReviewSessionPanel.tsx:116`) i kształt danych karty FSRS (3×: `fsrs.ts`, `review-reset.ts`, `ReviewSessionPanel.tsx`) |
| Gdzie typ biblioteki wycieka do kontraktu wire? | `grade: Grade` w body POST (`ReviewSessionPanel.tsx:206`) i surowe kolumny FSRS w odpowiedzi GET (`review.ts:51-71`) |
| Czy dokumenty deklarują wymienialność, a kod jej nie dotrzymuje? | Tak — `prd.md:94,120,128` i `srs-library-research.md:33` — zacytowane w KROK 0/3, rozjazd jest największy ze wszystkich rozpatrzonych kandydatów |

---

## KROK 4 — Projekt Anti-Corruption Layer

### Domenowy value object — jedyne miejsce wiedzy o kształcie zależności

```
// Jedyny typ w całym repo, który zna zarówno kształt wiersza DB, jak i kształt
// typu biblioteki `Card` z ts-fsrs. Poza tym plikiem i adapterem (niżej) żaden
// inny kod nie wie, że pod spodem jest FSRS.
class ReviewSchedule {
  private constructor(private readonly fields: {
    due: Date
    stability: number
    difficulty: number
    elapsedDays: number
    scheduledDays: number
    learningSteps: number
    reps: number
    lapses: number
    stage: ReviewStage        // własny enum domenowy, NIE re-eksport ts-fsrs `State`
    lastReview: Date | null
  }) {}

  // persystencja -> domena (zastępuje ad-hoc odczyty w review.ts:51-59, review-reset.ts)
  static fromRow(row: CardScheduleRow): ReviewSchedule { ... }

  // domena -> persystencja (zastępuje fromFsrsCard w fsrs.ts:37-62)
  toRow(): CardScheduleRow { ... }

  // domena -> kontrakt HTTP. Dziś identyczny z toRow() w praktyce, ale
  // rozdzielenie znaczy, że zmiana kolumny DB (np. rename podczas migracji)
  // nie jest automatycznie zmianą kontraktu API.
  toWire(): ReviewScheduleDTO { ... }

  // kontrakt HTTP -> domena, używane przez /review-reset zamiast ResetCardInput
  // + isValidResetCard (review-reset.ts:6-60) — WALIDACJA JEST TU, RAZ.
  static fromWire(dto: unknown): ReviewSchedule /* throws InvalidScheduleError */ { ... }

  // Jedyne dwa miejsca w klasie, które w ogóle wiedzą o istnieniu ts-fsrs —
  // prywatne, wołane wyłącznie przez FsrsSchedulingEngine (adapter, niżej).
  private toLibraryCard(): FsrsCard { ... }
  private static fromLibraryCard(card: FsrsCard): ReviewSchedule { ... }
}

enum ReviewStage { New, Learning, Review, Relearning }   // własny, nie ts-fsrs `State`
type ReviewGrade = "again" | "hard" | "good" | "easy"     // własny, nie ts-fsrs `Rating`/`Grade`
```

### Wąski port + adapter

```
// Port domenowy — jedyny interfejs, który reszta aplikacji zna.
interface SchedulingEngine {
  rate(schedule: ReviewSchedule, grade: ReviewGrade, now: Date): ReviewSchedule
  previewAllGrades(schedule: ReviewSchedule, now: Date): Record<ReviewGrade, Date>
}

// Adapter — JEDYNY plik w repo (poza testami samego adaptera), który importuje `ts-fsrs`.
// Zastępuje dzisiejsze src/lib/fsrs.ts.
class FsrsSchedulingEngine implements SchedulingEngine {
  // Jedyna instancja silnika w całym repo — koniec z dwiema niezależnymi
  // kopiami (fsrs.ts:6 + ReviewSessionPanel.tsx:116).
  private readonly scheduler = fsrs(generatorParameters({ enable_short_term: false }))

  private static readonly GRADE_TO_RATING: Record<ReviewGrade, Rating> = {
    again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy,
  }

  rate(schedule, grade, now) {
    const libCard = schedule.toLibraryCard()
    const { card } = this.scheduler.next(libCard, now, FsrsSchedulingEngine.GRADE_TO_RATING[grade])
    return ReviewSchedule.fromLibraryCard(card)
  }

  previewAllGrades(schedule, now) {
    const libCard = schedule.toLibraryCard()
    const record = this.scheduler.repeat(libCard, now)
    return {
      again: record[Rating.Again].card.due,
      hard: record[Rating.Hard].card.due,
      good: record[Rating.Good].card.due,
      easy: record[Rating.Easy].card.due,
    }
  }
}
```

### Kluczowa decyzja projektowa: podgląd (`preview`) przenosi się na serwer

Dzisiejszy powód, dla którego `ts-fsrs` w ogóle trafia do przeglądarki, to podgląd czterech możliwych dat
`due` pokazywany pod przyciskami ocen (`ReviewSessionPanel.tsx:196-204`, `formatInterval`). To jedyne
uzasadnienie dla obecności silnika po stronie klienta — i nie ma powodu, dla którego musi tam być: to
czysta, deterministyczna funkcja stanu karty + aktualnego czasu, tania do policzenia serwerowo. Rozstrzygam
to tu (zgodnie z KROK 5 briefu — "otwarte pytania zależne od kontraktu biblioteki rozstrzygnąć w oparciu o
jej dokumentację, zakodować decyzję w ACL, nie w warstwie API"):

**`GET /api/decks/[id]/review` dołącza pole `preview: Record<ReviewGrade, string>` do każdej zwracanej
karty**, policzone przez `SchedulingEngine.previewAllGrades()` po stronie serwera w momencie odpowiedzi.
Klient przestaje potrzebować `ts-fsrs` **w ogóle** — renderuje gotowe stringi dat, nie oblicza niczego.

### Cienkie API (przykład: `POST /review`, dziś `review.ts:74-163`)

```
export const POST: APIRoute = async (context) => {
  requireAuth(context)                                        // -> 401
  const input = parseGradeShapeOnly(context)                  // -> 400, tylko kształt JSON

  const row = await cardRepo.findDueCard(context.params.id, input.cardId, ownerId)  // -> 404
  const schedule = ReviewSchedule.fromRow(row)
  const updated = schedulingEngine.rate(schedule, input.grade, new Date())          // JEDYNE wywołanie ts-fsrs w tej ścieżce, ukryte w adapterze
  await cardRepo.saveSchedule(context.params.id, input.cardId, updated.toRow())

  return json({ due: updated.toWire().due, remainingDue: await cardRepo.countDue(...) }, 200)
}
```

Handler nie importuje `ts-fsrs`, nie zna `Rating`/`Grade`/`Card` z biblioteki — zna wyłącznie
`ReviewSchedule`, `SchedulingEngine` (port) i własny `ReviewGrade`.

### Punkt styku z Doc 02

Jeśli agregat `Deck`/`Card` z Doc 02 zostanie zaimplementowany, `ReviewSchedule` naturalnie staje się
wartością przechowywaną **wewnątrz** encji `Card` (kompozycja, nie dziedziczenie) — `Card.schedule:
ReviewSchedule`. Oba refaktory są jednak niezależne: ten dokument nie wymaga istnienia agregatu `Deck`, by
zadziałać — `ReviewSchedule`/`SchedulingEngine` mogą powstać i zostać podłączone do dzisiejszych cienkich
handlerów bez czekania na Doc 02.

---

## KROK 5 — Dowód izolacji + before/after

### Które pliki dziś znają `ts-fsrs` → które po refaktorze

| Plik | Dziś zna `ts-fsrs`? | Po refaktorze |
|---|---|---|
| `src/lib/fsrs.ts` (zastąpiony przez `src/lib/scheduling/fsrs-adapter.ts`) | Tak (import + instancja + konwersje) | Tak — **jedyny** produkcyjny plik, który go importuje |
| `src/pages/api/decks/[id]/review.ts` | Tak (import z `@/lib/fsrs`, wywołanie `scheduler.next`) | **Nie** — zna tylko `SchedulingEngine`, `ReviewSchedule` |
| `src/pages/api/decks/[id]/review-reset.ts` | Nie importuje, ale rekonstruuje kształt (`ResetCardInput`) | **Nie** — używa `ReviewSchedule.fromWire()`, zero własnej walidacji pól |
| `src/components/decks/ReviewSessionPanel.tsx` | Tak (import + instancja + wykonanie w przeglądarce) | **Nie** — zero importu `ts-fsrs`; renderuje `ReviewGrade` (string union) i gotowe stringi `preview` z odpowiedzi API |
| `tests/unit/fsrs.test.ts` (przenoszony do `tests/unit/fsrs-adapter.test.ts`) | Tak | Tak — testuje wyłącznie adapter, co jest poprawne (adapter jest jedynym miejscem z logiką wartą testowania względem samej biblioteki) |

**Kryterium sukcesu (grep):** `grep -rn "ts-fsrs" src/` po refaktorze zwraca wyłącznie
`src/lib/scheduling/fsrs-adapter.ts` (plus ewentualny plik typu `ReviewSchedule` jeśli konwersje do/z typu
biblioteki zostaną w osobnym pliku obok adaptera — nadal ten sam katalog `src/lib/scheduling/`). Zero trafień
w `src/pages/api/**` i zero w `src/components/**`.

### Before/after zduplikowanych miejsc

| Miejsce | Dziś | Po refaktorze |
|---|---|---|
| Instancja silnika | 2× (`fsrs.ts:6`, `ReviewSessionPanel.tsx:116`), config zduplikowany | 1×, wewnątrz `FsrsSchedulingEngine` |
| Kształt "karta FSRS" | 3× (`FsrsFields`, `ResetCardInput`, obiekt w `ratedSnapshots`) | 1× (`ReviewSchedule`, prywatne pole `fields`) |
| Walidacja pól resetu | Ręczna, `review-reset.ts:20-60`, semantyka rozbieżna z resztą systemu | `ReviewSchedule.fromWire()` — jedna implementacja, używana też (docelowo) przy odczycie |
| Typ `grade` w kontrakcie HTTP | `Grade` z `ts-fsrs` (`ReviewSessionPanel.tsx:206`) | `ReviewGrade` własny string union |
| Podgląd interwałów | Liczony w przeglądarce, silnik FSRS w bundlu klienta | Liczony serwerowo (`previewAllGrades`), klient dostaje gotowe daty w polu `preview` odpowiedzi GET |
| Reset sesji (`confirmReset`) | Klient wysyła z powrotem surowe 10 pól FSRS, które musi pamiętać i poprawnie odtworzyć (`ReviewSessionPanel.tsx:213-224,282`) | Klient echo'uje nieprzezroczysty `ReviewScheduleDTO` otrzymany wcześniej z GET/POST — nie musi znać ani jednego pola z nazwy |

### Warstwa UI dostaje gotowe dane domenowe, nie surowy obiekt biblioteki

Dziś: `ReviewSessionPanel.tsx` importuje `Rating`/`Grade` z `ts-fsrs`, buduje własny silnik, wykonuje
`.repeat()` lokalnie i zna wprost 10-polowy kształt DB (`FsrsFields`). Po refaktorze: komponent zna tylko
`ReviewGrade` (`"again" | "hard" | "good" | "easy"`, zdefiniowany w domenie aplikacji, nie w bibliotece),
otrzymuje `preview: Record<ReviewGrade, string>` gotowe z API, i przy resecie odsyła nieprzezroczysty obiekt
`ReviewScheduleDTO` bez potrzeby rozumienia jego pól. Zero importu `ts-fsrs` w jakimkolwiek pliku pod
`src/components/**`.

---

## KROK 6 — Weryfikacja i plan faz

### Kryterium sukcesu

```
grep -rn "ts-fsrs" src/
```
Po refaktorze: wyłącznie w `src/lib/scheduling/` (adapter + ewentualny plik typu). Zero w `src/pages/api/**`,
zero w `src/components/**`.

### Plan faz (zgodny z konwencją test-first ustaloną w Doc 02, projekt ma działający Vitest)

1. **Faza 0 (bez zmian w kodzie).** Ten dokument. Decyzja do potwierdzenia z użytkownikiem: przeniesienie
   podglądu (`preview`) na serwer zmienia kształt odpowiedzi `GET /review` (nowe pole na każdej karcie) —
   zmiana kontraktu, nieszkodliwa wstecznie (dodanie pola), ale warta jawnej zgody przed implementacją.
2. **Faza 1 — `ReviewSchedule` jako czysta klasa domenowa**, bez `ts-fsrs` w sygnaturze publicznej.
   Test-first: `fromRow`/`toRow`/`toWire`/`fromWire` roundtrip, `fromWire` na niepoprawnym payloadzie rzuca
   `InvalidScheduleError` z tymi samymi granicami co dzisiejsze `isValidResetCard` (zachowanie zachowane,
   duplikacja usunięta).
3. **Faza 2 — `FsrsSchedulingEngine` implementujący port `SchedulingEngine`**, zastępujący
   `src/lib/fsrs.ts`. Test-first, przenosząc dzisiejsze `tests/unit/fsrs.test.ts` na testy adaptera —
   asercje o `enable_short_term: false` pozostają, teraz uruchamiane przeciw jedynej instancji silnika w
   repo.
4. **Faza 3 — przepięcie `review.ts` i `review-reset.ts`** na `ReviewSchedule` + `SchedulingEngine`;
   `GET /review` dokłada pole `preview` liczone serwerowo. Test-first: nowy test integracyjny asercjonujący
   obecność `preview` w odpowiedzi GET z czterema kluczami `again/hard/good/easy`.
5. **Faza 4 — usunięcie `ts-fsrs` z `ReviewSessionPanel.tsx`.** Komponent przestaje budować własny silnik i
   liczyć podgląd lokalnie; czyta `card.preview` z odpowiedzi API. `confirmReset` wysyła z powrotem
   nieprzezroczysty `ReviewScheduleDTO` zamiast ręcznie wypisanych 10 pól.
6. **Faza 5 (weryfikacja).** `grep -rn "ts-fsrs" src/` — potwierdzenie kryterium sukcesu z KROK 6 powyżej.

---

## Podsumowanie

Zidentyfikowano trzy zewnętrzne zależności z potencjałem przecieku międzywarstwowego (`ts-fsrs`,
`@supabase/supabase-js`, klient OpenRouter) i sklasyfikowano je na trzech osiach: liczba dotkniętych warstw,
koszt wymiany dziś, oraz czy dokumenty deklarują wymienialność. `ts-fsrs` wygrywa jednoznacznie — to jedyny
pakiet w repo importowany jednocześnie w warstwie `lib`, API i komponencie React renderowanym w przeglądarce
(`client:load`), z dwiema niezależnymi instancjami tego samego silnika (`src/lib/fsrs.ts:6` i
`ReviewSessionPanel.tsx:116`), trzema rozbieżnymi rekonstrukcjami kształtu jego danych, oraz typem biblioteki
(`Grade`) wyciekającym wprost do kontraktu HTTP. Co ważniejsze, to jedyny kandydat, dla którego **dwa
niezależne dokumenty** — PRD ("scheduling delegated to a third-party SRS service", jawny Non-Goal wobec
własnej implementacji algorytmu) i osobna notatka decyzyjna ("computed server-side... no review data leaves
our infrastructure") — deklarują, że mechanizm ma pozostać ukryty za granicą serwera/usługi, podczas gdy kod
uruchamia tę samą bibliotekę lokalnie w przeglądarce, by policzyć podgląd interwałów. Zaprojektowano value
object `ReviewSchedule` jako jedyne miejsce wiedzy o kształcie zależności (konwersja do/z wiersza DB, do/z
kontraktu HTTP, do/z typu biblioteki) oraz wąski port `SchedulingEngine` z adapterem `FsrsSchedulingEngine`
jako jedynym plikiem produkcyjnym importującym `ts-fsrs`. Kluczowe rozstrzygnięcie projektowe: obliczanie
podglądu ocen przenosi się z przeglądarki na serwer, eliminując jedyny realny powód, dla którego biblioteka
FSRS trafiała dziś do bundla klienta. Kryterium sukcesu — `grep -rn "ts-fsrs" src/` zwracający wyłącznie
plik adaptera — daje jednoznaczny, mechanicznie weryfikowalny dowód zamknięcia przecieku. Plan faz jest
test-first i niezależny od refaktoru agregatu `Deck` opisanego w `02-invariant-aggregate-refactor.md`, choć
oba się naturalnie uzupełniają.
