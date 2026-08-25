---
title: "Destylacja domeny — 10xFiszki"
created: 2026-08-24
type: domain-distillation
---

# Destylacja domeny: 10xFiszki

## KROK 0 — Odkryty kontekst

Źródła przeczytane w całości:
- `context/foundation/prd.md` — PRD v1, status `draft`, greenfield, deadline 2026-08-10 (już minięty względem daty tego dokumentu — PRD nie było aktualizowane po starcie implementacji).
- `context/foundation/tech-stack.md` — Astro 6 SSR + Supabase (Postgres/Auth) + Cloudflare Pages, TypeScript end-to-end.
- `context/foundation/roadmap.md` — rozbicie PRD na 9 slice'ów (F-01, S-01…S-09), wszystkie oznaczone `done`. Zawiera decyzje podjęte **po** PRD, które nie zostały odwzorowane z powrotem w `prd.md` (patrz KROK 4).
- `context/archive/2026-08-02-account-deletion/change.md` — jedyny FR-mniejszościowy feature bez pokrycia w PRD; jawnie oznaczony `PRD refs: — not in PRD v1`.
- Migracje SQL w `supabase/migrations/*.sql` (6 plików) — traktowane jako źródło prawdy o niezmiennikach na poziomie danych.
- Kod źródłowy: wszystkie route'y w `src/pages/api/**`, `src/middleware.ts`, `src/lib/fsrs.ts`, `src/lib/openrouter.ts`, `src/lib/supabase.ts`, kluczowe komponenty React (`GenerateFlashcardsPanel.tsx`, `ReviewSessionPanel.tsx`).

**Ograniczenie:** `idea-notes.md` i `context/foundation/shape-notes.md` nie zostały przeczytane w całości (tylko rozmiar sprawdzony) — nie powinny zawierać nic, czego nie ma już w PRD/roadmapie, ale nie jest to zweryfikowane. Pozostałe archiwalne `plan.md` (deck-management, card-browsing, manual-creation, spaced-repetition, ux-improvements, ui-polish, integration-test-fixes) nie zostały czytane — roadmapa i kod źródłowy uznano za wystarczające dowody dla ich zakresu.

Stack: logika biznesowa żyje niemal wyłącznie w warstwie API routes (`src/pages/api/**`) — cienkie handlery Astro bez osobnej warstwy serwisu/domeny. Reguły integralności (unikalność, długości, kaskady) są przesunięte do Postgresa (CHECK constraints, unique indexes, RLS policies, FK cascades) i egzekwowane głównie tam, nie w TypeScript.

---

## KROK 1 — Ubiquitous Language

| Pojęcie | Definicja | Cytat źródłowy | Gdzie żyje w kodzie |
|---|---|---|---|
| **Deck** (talia) | Nazwany kontener kart należący do jednego użytkownika | "User can create a named deck" — `prd.md:66` (FR-004) | `decks` table, `supabase/migrations/20260729164431_deck_card_schema_foundation.sql:7-15`; `src/pages/api/decks/index.ts` |
| **Card / Flashcard** (fiszka) | Para front/back, zawsze należąca do jednej talii | "manually create a flashcard (front and back)" — `prd.md:80` (FR-009) | `cards` table, `.../20260729164431_...sql:21-29`; `src/pages/api/decks/[id]/cards.ts` |
| **Card source** (proweniencja) | Klasyfikacja pochodzenia karty: `ai` lub `manual`, nadawana raz przy tworzeniu | Rozróżnienie FR-007/008 (AI) vs FR-009 (manual) — `prd.md:74-81`; słowo "source" nie pada w PRD wprost | `create type card_source as enum ('ai','manual')` — `.../20260729164431_...sql:3`; `cards.ts:131` (`source: "ai"`), `cards/manual.ts:62` (`source: "manual"`) |
| **Flashcard Proposal** (propozycja) | Wygenerowana przez AI para front/back, jeszcze nie zapisana — istnieje tylko w pamięci do momentu accept | "the output is a set of flashcard proposals" — `prd.md:110` | `FlashcardProposal` — `src/lib/openrouter.ts:18-21`; `Proposal` — `src/components/decks/GenerateFlashcardsPanel.tsx:11-15` |
| **Decision (accept/reject)** | Werdykt użytkownika na propozycji przed zapisem do talii | "can accept or reject each proposal" — `prd.md:47,76` (FR-008) | `Proposal.decision: "accepted" \| "rejected" \| null` — `GenerateFlashcardsPanel.tsx:14` |
| **Review session** | Zbiór kart z talii, których termin (`due`) minął, prezentowanych jedna po drugiej do oceny | "start a spaced repetition review session for a deck" — `prd.md:92` (FR-013) | `GET /api/decks/[id]/review` (filtr `due <= now()`, limit 30) — `src/pages/api/decks/[id]/review.ts:51-59`; `ReviewSessionPanel.tsx` |
| **Grade / Rating** (ocena przypomnienia) | Ocena 1-4 (Again/Hard/Good/Easy) nadawana karcie po jej pokazaniu | "rate their recall on each card" — `prd.md:94` (FR-014); skala rozstrzygnięta w Open Question #1 — `prd.md:128` | `RatePayload.grade` 1-4 — `review.ts:9-24`; `Rating.Again/Hard/Good/Easy` z `ts-fsrs` — `ReviewSessionPanel.tsx:25-64` |
| **Scheduling state** (stan FSRS) | Zestaw pól (`due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review`) opisujących pozycję karty w algorytmie powtórek | "review progress, scheduling state" (guardrail) — `prd.md:37,101` | Kolumny dodane w `.../20260801130000_cards_fsrs_fields.sql:6-16`; `FsrsFields` — `src/lib/fsrs.ts:8-20` |
| **Source text** | Surowy tekst wklejony przez użytkownika jako wejście do generowania | "Source text submitted for AI generation" — `prd.md:38,102` | Parametr `text` w `POST /api/decks/[id]/generate` — `src/pages/api/decks/[id]/generate.ts:14-25`; nigdzie nie jest zapisywany do bazy (BRAK trwałej persystencji w kodzie) |
| **User / Account** | Właściciel talii i kart, uwierzytelniony e-mailem+hasłem, brak OAuth | "Flat role model — every logged-in user has identical capabilities" — `prd.md:116` | `auth.users` (Supabase Auth); `context.locals.user` — `src/middleware.ts:17` |
| **Account deletion request** | Żądanie usunięcia konta rozpoczynające 30-dniowy okres karencji | BRAK w PRD — patrz `context/archive/2026-08-02-account-deletion/change.md:14-15` | `account_deletion_requests` table — `.../20260802133021_account_deletion_requests.sql:3-6`; `src/pages/api/account/delete.ts` |
| **Pending deletion (blokada konta)** | Stan konta, w którym dostęp do funkcji jest zablokowany do czasu anulowania lub upływu karencji | BRAK w PRD | `PENDING_DELETION_EXEMPT_PATHS`, przekierowanie — `src/middleware.ts:6,39-41` |

---

## KROK 2 — Klasyfikacja subdomen

| Obszar / pojęcie | Klasyfikacja | Uzasadnienie (odwołanie do wizji/non-goals) |
|---|---|---|
| **Generowanie AI** (Source text → Flashcard Proposal, reguła klasyfikacji/ekstrakcji) | **Core** | Wizja wprost: "AI can turn any pasted text into a deck of flashcards in seconds... The app does not ask the user to specify what to extract or how to phrase it — those judgments are the app's job" (`prd.md:22,110`). To jedyny element, który stanowi przewagę produktu; sukces mierzony wprost tą zdolnością (75% acceptance rate, `prd.md:31`). |
| **Review workflow AI-proposals** (accept/reject per-card) | **Core** | "per-card accept/reject is the UX that produces the 75% acceptance rate metric" — `prd.md:77` (Socrates note do FR-008). Bezpośrednio sprzężone z metryką sukcesu produktu. |
| **Zarządzanie taliami (Deck)** | **Supporting** | Niezbędna organizacja, ale nie różnicuje produktu: "even 30–50 cards need organization... minimal organization primitive" (`prd.md:67`, Socrates do FR-004) — infrastruktura wokół rdzenia, nie sam rdzeń. |
| **Zarządzanie kartami** (ręczne tworzenie, przeglądanie, edycja, usuwanie) | **Supporting** | "manual creation is the escape hatch when AI misses something" (`prd.md:81`) — funkcja pomocnicza/zapasowa wobec ścieżki core. |
| **Sesja powtórek / prezentacja due-cards** (kolejkowanie, UI sesji) | **Supporting** | Sam mechanizm pokazywania kart i zbierania ocen jest niezbędny do zamknięcia pętli wartości, ale nie jest algorytmicznie różnicujący — różnicująca jest wcześniejsza generacja treści, nie sposób ich powtarzania. |
| **Algorytm planowania powtórek (SRS/FSRS)** | **Generic** | Jawny non-goal: "No custom SRS algorithm... third-party services are battle-tested" (`prd.md:120`) — PRD explicite odmawia temu statusu rdzenia, mimo że w kodzie jest to biblioteka in-process, nie usługa zewnętrzna (patrz KROK 4, rozjazd #1). |
| **Uwierzytelnianie (email+hasło)** | **Generic** | "Auth is table stakes for a multi-user app regardless of implementation choice" — `prd.md:59` (Socrates do FR-001); rozważano nawet zewnętrzny provider auth. |
| **Usuwanie konta / retencja 30 dni** | **Generic** | Standardowa funkcja cyklu życia konta SaaS, zero związku z propozycją wartości produktu; nieobecna nawet w PRD (patrz KROK 4). |

---

## KROK 3 — Kandydaci na agregaty i ich niezmienniki

### 1. Deck (agregat, korzeń)
| Niezmiennik | Cytat źródłowy | Status w kodzie |
|---|---|---|
| Nazwa talii unikalna per użytkownik (case-insensitive), 1-100 znaków, nie-pusta po trim | Wywiedzione z FR-004/005 (`prd.md:66-69`); brak jawnego zapisu o unikalności w PRD | **Egzekwowany w DB** — `unique index decks_user_id_lower_name_idx on decks (user_id, lower(name))` + `check (length(trim(name))>0 and length(name)<=100)` (`.../20260729164431_...sql:10,15`). Aplikacja robi **niebezpieczny** wstępny check-then-insert (`decks/index.ts:30-36`) — bez transakcji, więc race condition teoretycznie możliwy; DB unique index jest ostatecznym strażnikiem (`23505` łapane jako fallback, `decks/index.ts:38-39`). |
| Talia widoczna/modyfikowalna wyłącznie przez właściciela | "No user's cards, decks... accessible to any other user" — `prd.md:99` | **Egzekwowany wyłącznie przez RLS**, nie przez kod aplikacji — żaden endpoint (`decks/[id]/delete.ts:19`, `cards.ts`, `review.ts` itd.) nie filtruje po `user_id`; polega na tym, że klient Supabase jest tworzony z ciasteczkiem sesji (`src/lib/supabase.ts:7-11`), więc RLS-owe `auth.uid() = user_id` (`.../20260729164431_...sql:59-78`) jest jedyną linią obrony. |

### 2. Card (encja podrzędna wobec Deck — brak niezależnego dostępu bez `deck_id`)
| Niezmiennik | Cytat źródłowy | Status w kodzie |
|---|---|---|
| `front`/`back` niepuste po trim, ≤2000 znaków | FR-009 (`prd.md:80`) | **Egzekwowany w DB** (`check` w `.../20260729164431_...sql:24-25`) **i zduplikowany w każdym endpointcie** (`isValidCardInput` powtórzone identycznie w `cards.ts`, `cards/manual.ts`, `cards/[cardId].ts`). |
| `(deck_id, front, back)` unikalne w obrębie talii | BRAK w PRD — reguła istnieje tylko w kodzie | **Egzekwowany w DB** przez hash-index (`.../20260801114731_cards_unique_front_back.sql:5-6`). Surfaced jako przyjazny `409` tylko na ścieżkach manualnych (`cards/manual.ts:67-74`, `cards/[cardId].ts:69-76`) — **NIE** na ścieżce bulk-insert z AI (`cards.ts:135-140` zwraca surowy komunikat błędu Postgresa przy `23505`, cała paczka insertów pada naraz). |
| `source` (`ai`/`manual`) nadawane raz, niezmienne | Domniemane z FR-007 vs FR-009 | Enum na poziomie DB (`.../20260729164431_...sql:3`); nigdy nie jest aktualizowane po insert w żadnym `UPDATE` w kodzie — niezmienność de facto zachowana, ale nie ma jawnego zakazu (`update` na `cards.ts` [cardId].ts:60-66 aktualizuje tylko front/back). |
| Stan FSRS (`state` 0-3) w dozwolonym zakresie | Guardrail "scheduling state" (`prd.md:37,101`) | **Częściowo egzekwowany**: tylko `state` ma `check (state between 0 and 3)` (`.../20260801130000_...sql:15`). Pozostałe pola (`stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses`) **nie mają żadnego ograniczenia w DB**. `/review-reset` waliduje je ręcznie po stronie aplikacji (`review-reset.ts:20-59`), ale `/review` (ścieżka główna, `review.ts:129-137`) zapisuje wynik `scheduler.next()` **bez żadnej walidacji** — ufa bibliotece `ts-fsrs` w 100%. |

### 3. FlashcardGenerationRequest (koncept domenowy, nietrwały — nic nie jest zapisywane do momentu accept)
| Niezmiennik | Cytat źródłowy | Status w kodzie |
|---|---|---|
| Tekst bez ekstrahowalnych konceptów → zero lub prawie zero propozycji, żadnych "filler cards" | "Text that has no extractable concepts... should produce zero or near-zero proposals, not filler cards" — `prd.md:112` | **Deklarowany wyłącznie w prompt systemowym** wysyłanym do modelu LLM: "If the text has no extractable concepts... return an empty array. Do not invent filler cards." — `src/lib/openrouter.ts:13-14`. **Brak jakiejkolwiek mechanicznej weryfikacji** tego zachowania w kodzie — to najważniejszy niezmiennik core-domeny w całym PRD i jest egzekwowany wyłącznie przez instrukcję tekstową do niedeterministycznego modelu, bez testu, który by to sprawdzał. |
| Propozycja: `front`/`back` niepuste, ≤2000 znaków | Domniemane z limitu karty (FR-009) zastosowanego wstecznie do propozycji | `isValidProposal` — `openrouter.ts:25-36`; nieprawidłowe propozycje są cicho odfiltrowywane (brak błędu, gdy wszystkie odpadną — użytkownik widzi po prostu pustą listę). |

### 4. AccountDeletionRequest (agregat, korzeń — całkowicie nieudokumentowany w PRD)
| Niezmiennik | Cytat źródłowy | Status w kodzie |
|---|---|---|
| Jedno oczekujące żądanie usunięcia na użytkownika | — (`change.md:14`) | **Egzekwowany w DB** — `user_id uuid primary key` (`.../20260802133021_...sql:3-6`). |
| 30-dniowy okres karencji przed trwałym usunięciem | "the account and its data... are retained for 30 days before permanent purge" — `change.md:14` | **Zduplikowana logika**: cron SQL `requested_at < now() - interval '30 days'` (`.../20260802133023_...sql:12-13`) **oraz** niezależne przeliczenie w JS `30 - Math.floor((Date.now()-requestedAt)/86_400_000)` (`src/pages/account/pending-deletion.astro:10-11`) — brak wspólnej stałej, dwie implementacje tej samej reguły muszą pozostawać zsynchronizowane wyłącznie przez konwencję. |
| Konto zablokowane (poza cancel/signout) podczas oczekiwania | "Your account and data are locked while this request is pending" — `pending-deletion.astro:41` | Egzekwowany w middleware dla stron **i** API (`/api/decks`, `/api/account` są w `PROTECTED_ROUTES`) — `src/middleware.ts:4,6,39-41`. Spójne. |

---

## KROK 4 — Rozjazdy MODEL vs KOD

| # | Dokument mówi | Kod robi | Dowód |
|---|---|---|---|
| 1 | FR-014: scheduling "delegated to a third-party SRS service" | Biblioteka `ts-fsrs` uruchamiana in-process w tym samym serwisie — brak jakiegokolwiek zewnętrznego wywołania SRS | `prd.md:94` (PRD samo flaguje to w Open Question #1, `prd.md:128`) vs `src/lib/fsrs.ts:1-6` |
| 2 | Non-Goals: "No custom SRS algorithm... third-party services are battle-tested" | Parametry FSRS (`enable_short_term: false`) są świadomie dostrajane w tym repo; endpoint `/review-reset` ręcznie reimplementuje walidację kształtu danych FSRS | `prd.md:120` vs `fsrs.ts:6`, `review-reset.ts:20-59` |
| 3 | Open Question #3 (wciąż otwarte w treści pliku): "cascade delete, or archive?" dla kart usuwanej talii | Decyzja już podjęta i wdrożona: `deck_id ... references decks (id) on delete cascade` | `prd.md:130` vs `.../20260729164431_...sql:23`; roadmapa odnotowuje rozstrzygnięcie (`roadmap.md:77`), ale `prd.md` nigdy nie został zaktualizowany |
| 4 | PRD nie zawiera ani jednego FR/NFR dotyczącego usuwania konta | Kompletna funkcja: żądanie → 30-dniowa karencja → cron purge → blokada konta w middleware | `prd.md` (brak wzmianki) vs `.../20260802133021_...sql`, `.../20260802133023_...sql`, `src/pages/api/account/*`, `src/middleware.ts:6`; roadmapa wprost: "— not in PRD v1" (`roadmap.md:38`) |
| 5 | Sekcja "Business Logic" PRD nigdy nie wspomina reguły unikalności kart | DB egzekwuje unikalność `(deck_id, hash(front), hash(back))` | `prd.md:106-116` vs `.../20260801114731_cards_unique_front_back.sql:5-6` |
| 6 | (konsekwencja #5) Ta sama reguła unikalności nie jest obsłużona spójnie | Ścieżka manualna zwraca przyjazny `409`; ścieżka bulk-insert z AI (`cards.ts` POST) nie łapie `23505` w ogóle — cała paczka pada z surowym błędem DB | `cards/manual.ts:67-74` vs `cards.ts:131-140` |
| 7 | NFR: "No user's cards, decks, or review history are accessible to any other user under any circumstances" | Żaden endpoint API nie weryfikuje własności zasobu po stronie aplikacji (brak `.eq("user_id", ...)` na deckach, brak sprawdzenia że `deck_id` należy do zalogowanego użytkownika przy operacjach na kartach) — całość opiera się wyłącznie na RLS | `prd.md:99` vs np. `decks/[id]/delete.ts:19`, `cards.ts`, `review.ts`, potwierdzone przez `src/lib/supabase.ts:7-11` (klient budowany z ciasteczka sesji, nie service-role) |
| 8 | Guardrail: "Source text submitted for AI generation must not be retained or exposed beyond what is strictly necessary" | Kod tej aplikacji nigdy nie zapisuje `source text` do bazy — ale retencja po stronie zewnętrznego dostawcy (OpenRouter) nie jest w żaden sposób zaadresowana ani zweryfikowana w kodzie czy dokumentach | `prd.md:38,102` vs `src/pages/api/decks/[id]/generate.ts` (brak insertu tekstu) — deklaracja częściowo spełniona, częściowo nieweryfikowalna |

---

## KROK 5 — Ranking refaktoru

| Ranga | Kandydat | Wartość (jak rdzeniowy) | Ryzyko (jak słabo egzekwowany dziś) |
|---|---|---|---|
| **#1** | Niezmiennik "brak ekstrahowalnych konceptów → zero propozycji" (generowanie AI) | Najwyższa — to jedyny mechanizm bezpośrednio odpowiadający za metrykę sukcesu produktu (75% acceptance) | Najwyższe — egzekwowany wyłącznie tekstem promptu do niedeterministycznego modelu, zero testów, zero walidacji wyniku poza formatem JSON |
| #2 | Izolacja danych między użytkownikami (Deck/Card ownership) | Wysoka — twardy NFR bez wyjątków | Średnie-wysokie — dziś poprawnie egzekwowany, ale przez pojedynczą warstwę (RLS) bez żadnej redundancji w aplikacji; jeden błąd w polityce RLS lub przypadkowe użycie klucza service-role ujawnia dane wszystkich użytkowników |
| #3 | Unikalność kart niespójnie obsłużona między ścieżką manualną a bulk-AI | Średnia — dotyczy core-flow (accept AI proposals) | Średnie — konkretny, odtwarzalny scenariusz błędu (patrz niżej) |
| #4 | Asymetryczna walidacja pól FSRS (`/review` ufa bibliotece bezwarunkowo, `/review-reset` waliduje ręcznie) | Niska-średnia — `ts-fsrs` to zaufana biblioteka zewnętrzna | Niska-średnia — ryzyko ujawni się dopiero przy zmianie wersji `ts-fsrs` lub buga w niej |
| #5 | Zduplikowana reguła "30 dni" (SQL cron vs JS w komponencie) | Niska — kosmetyczny/rzadko zmieniany parametr | Niska — łatwe do naprawienia, niski koszt pozostawienia |

### #1 do refaktoru: dlaczego

To jedyny niezmiennik w całym systemie, który jest jednocześnie (a) explicite core-domain — bezpośrednio zapisany jako mechanizm sukcesu produktu w sekcji "Business Logic" PRD — oraz (b) egzekwowany zerową ilością kodu weryfikującego. `isValidProposal` (`openrouter.ts:25-36`) sprawdza tylko kształt (niepuste stringi, limit długości) — nie sprawdza w ogóle **liczby** ani **trafności** wygenerowanych propozycji względem treści wejściowej. Nie istnieje żaden test (w `tests/` ani `playwright/`) który podaje tekst "trywialny/pusty" i asertuje pustą lub prawie pustą listę propozycji. Skoro to dokładnie ten mechanizm decyduje o spełnieniu głównego kryterium sukcesu produktu (75% acceptance rate, `prd.md:31`), brak jakiejkolwiek zamkniętej pętli weryfikacji (choćby złotego zestawu przykładów input→oczekiwana-liczba-kart uruchamianego w CI) jest największą luką między modelem domeny a jego wdrożeniem.

---

## Podsumowanie

Artefakt rekonstruuje słownik domenowy 10xFiszki (Deck, Card, Flashcard Proposal, Review session, Scheduling state, Account deletion request) z cytatami do PRD i kodu, klasyfikuje obszary na Core (generowanie AI i pętla accept/reject), Supporting (talie, karty, mechanika sesji powtórek) i Generic (algorytm FSRS, uwierzytelnianie, usuwanie konta) oraz wskazuje cztery kandydatów na agregaty wraz ze statusem egzekwowania ich niezmienników. Najważniejszy wniosek: logika biznesowa żyje niemal wyłącznie w Postgresie (CHECK, unique index, RLS, FK cascade) i w treści promptu systemowego wysyłanego do LLM — kod TypeScript w warstwie API jest cienką, wielokrotnie duplikującą walidację nakładką, bez osobnej warstwy domeny. Ujawniono osiem konkretnych rozjazdów model-kod, z których dwa są poważne: (1) PRD nigdy nie zaktualizowano po decyzjach podjętych w roadmapie/planach (kaskadowe usuwanie talii, wybór self-hosted FSRS zamiast usługi trzeciej), a (2) cała funkcja usuwania konta z 30-dniową karencją istnieje w produkcji, ale nie ma żadnego odpowiednika w PRD. Najwyższym priorytetem do wzmocnienia jest niezmiennik "tekst bez treści → zero fiszek" — jedyny mechanizm bezpośrednio odpowiedzialny za metrykę sukcesu produktu, dziś egzekwowany wyłącznie instrukcją tekstową do modelu AI, bez żadnego testu weryfikującego.
