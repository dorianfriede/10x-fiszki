---
title: "Raport architektoniczny — Moduł 4 (10xArchitect)"
created: 2026-08-25
type: architect-report
---

# Raport architektoniczny — Moduł 4 (10xArchitect)

## 1. Opisane projekty

| Repo | Stack | Skala (orientacyjnie) | Artefakt(y) |
|---|---|---|---|
| **tldraw/tldraw** | Monorepo TS: warstwowy SDK (`utils`→`state`/`validate`→`store`/`tlschema`→`editor`→`tldraw`) + osobny stos sync/backend (`sync-core`/`sync-collaboration`, Cloudflare Worker, Zero/`@rocicorp/zero`, Postgres) | 51 pakietów workspace, `Editor.ts` 11 761 linii / 436 importerów, `tldraw` 768 importerów, `dotcom-shared` 108 importerów | L2 (repo-map), L3 (research pinFile/unpinFile), L4 (plan capability-check enforcement) |
| **10xFiszki** (ten projekt) | Astro 6 SSR + Supabase (Postgres/Auth) + Cloudflare Pages, TypeScript end-to-end, logika biznesowa w cienkich handlerach `src/pages/api/**` | Mały: ~9 slice'ów roadmapy, kilka tabel (decks, cards, account_deletion_requests), brak osobnej warstwy domeny | L5 (notatki DDD: destylacja domeny, agregat Deck, ACL dla ts-fsrs) |

L2–L4 pochodzą z **tldraw/tldraw**, L5 z **10xFiszki**. Wnioski nie są łączone między repozytoriami poza sekcją 6.

## 2. Mapa projektu (z L2 — tldraw/tldraw)

- **Dwa równoległe stosy, jeden świadomy most.** Canvas/UI (`editor`→`tldraw`) i backend/sync (`sync-core`→`sync-collaboration`) są wzajemnie niezależne; jedyny most to `packages/dotcom-shared` (108 importerów), krzyżujący granicę tylko `type-only`, ale realnie sprzęgający `apps/dotcom/client` i `apps/dotcom/sync-worker` — potwierdzone niezależnie: dependency graph + git co-change (top-3 par).
- **`Editor.ts` — god-object wysokiego ryzyka:** 11 761 linii, najwyższy churn w repo (107 zmian/12mc), 44 bezpośrednich importerów w SDK. Czy to faktyczny monolit czy duża klasa z dobrze wydzielonymi helperami — **nieustalone** (Deep Focus).
- **`tla` nie jest czystą granicą feature'u:** 87 plików w `tla` sięga do korzenia klienta, 11 plików spoza `tla` sięga z powrotem — potwierdzone też przez co-change (#2 para ogólnie).
- **Permissions/RBAC — świeże, skoncentrowane, wciąż "finding edge cases".** Model `capabilities.ts`/`roles.ts` zaprojektowany od zera przez jedną osobę (Kevin Ingersoll, VI 2026); ostatnia poprawka (#10301, 2026-08-22) dotyczyła luki bezpieczeństwa w pin/unpin.
- **Unknowns nazwane wprost:** brak audytu poprawności tras auth w `sync-worker`; nieznane pokrycie kontrybutorów dla `Editor.ts` i `tla`; blind spot CI dla cyklu `ui/components`/`ui/context`.

## 3. Analiza ficzera (z L3 — tldraw/tldraw)

**Który przepływ i dlaczego:** `pinFile`/`unpinFile` (`packages/dotcom-shared/src/mutators.ts`) — wynika wprost z ryzyka RBAC (sekcja 2), wybrany bo łączy "before" (brak `can()` w ogóle) i "after" (fix #10301) w jednym, weryfikowalnym przypadku.

**Feature overview:** Klik w menu pliku (`TlaFileMenu.tsx`) wywołuje `app.z.mutate.pinFile(...)` — ten sam mutator biegnie optymistycznie lokalnie (IndexedDB) i autorytatywnie na serwerze (`sync-worker` → Postgres, po weryfikacji Clerk JWT). Stan: `group_file.index` (fractional index = kolejność pinowania); brak indeksu = niepięty. Odpowiedź wraca jako JSON resolve/reject, ale `handlePinUnpinClick` nie obsługuje odrzucenia (brak toastu, w przeciwieństwie do `createFile`).

**Technical debt (potwierdzony ast-grepem + grep):**
1. **Brak parowania testów happy/forbidden** — jedyny wyjątek od konwencji w `mutators.test.ts` (40 wywołań `expectForbidden()` sparowanych z 9 innymi mutatorami). `pinFile` ma tylko happy-path, `unpinFile` żadnego. Potwierdzone strukturalnie tabelą per-mutator (ast-grep `can($ROLE,$CAP)` + `expectForbidden($$$ARGS)`, krzyżowane z grep).
2. **Dwie niezależne implementacje `getRole`** (`mutators.ts`: Zero/zql; `sync-worker/getRole.ts`: Kysely/Postgres) — potwierdzone czytaniem obu ciał; pierwsza ma skrót dla home-workspace, druga nie. Rozjazd potencjalny, zasięg nieprześledzony.
3. **Client-side re-check capability w 3 miejscach**, cache'owanych lokalnie, niezależnie od serwera — ryzyko UX, nie bezpieczeństwa (serwer nadal jest bramką).

## 4. Plan refaktoryzacji (z L4 — tldraw/tldraw)

**Co refaktoryzowane:** Candidate C4 — brak strukturalnego wymuszenia konwencji "capability-check + test pairing". Docelowy kształt: (a) testy forbidden-path dla pin/unpin, (b) 12 wywołań `assert(can(...))` skonsolidowane do `requireCapability()`, (c) reguła oxlint w `tldraw-plugin.mjs` flagująca mutator bez rozpoznanego wzorca autoryzacji, (d) reguła włączona w CI (`.oxlintrc.json`).

**Czego świadomie NIE robimy:** ujednolicenie dwóch implementacji `getRole` (C1 — rozwiązane inaczej); hook `useCan()` po stronie klienta (C2 — niższy priorytet, nie luka bezpieczeństwa); obsługa błędu w `handlePinUnpinClick` (C3 — osobna sprawa); zmiana modelu persystencji ról jako stringów (C5); wyścig w indeksowaniu pin/unpin (C6 — kosmetyczny, zaakceptowany); harness testowy dla samego pluginu oxlint (brak precedensu w repo).

**Fazy (jedna linijka + weryfikacja):**
1. Testy forbidden-path dla pin/unpin — automat: `yarn test run`; ręcznie: usunięcie asercji potwierdza czerwony test.
2. Ekstrakcja `requireCapability()` (12 call site'ów) — automat: `yarn test run` + `yarn typecheck`; ręcznie: diff review 12 miejsc.
3. Reguła oxlint zbudowana, ale nieaktywna — automat: `yarn lint` bez rejestracji; ręcznie: lokalne włączenie potwierdza zero false-positive i wykrycie usuniętego checka.
4. Włączenie reguły w CI — automat: `yarn lint` + `yarn typecheck` czysto z repo root.

## 5. Domena wg DDD (z L5 — 10xFiszki)

**Ubiquitous language:** *Deck* (talia, kontener kart 1 użytkownika), *Card* (front/back, zawsze podrzędna wobec Deck), *Flashcard Proposal* (nietrwały koncept — istnieje tylko w pamięci do `accept`), *Review session* (karty z `due<=now`), *Scheduling state* (10 pól FSRS).

**Najważniejsze rozjazdy model-vs-kod:** (1) PRD deklaruje scheduling jako "delegated to a third-party SRS service", kod uruchamia `ts-fsrs` in-process — PRD samo to flaguje w Open Question #1, nigdy nie zaktualizowane. (2) Cała funkcja usuwania konta (30-dniowa karencja) istnieje w produkcji bez żadnej wzmianki w PRD.

**Niezmiennik wybrany do refaktoru i agregat:** Połączony **I2+I3** — *unikalność karty `(deck_id, front, back)` w obrębie talii + brak cichej/nienaprawialnej utraty zaakceptowanych propozycji przy zapisie*. Dokument L5/02 świadomie **odrzuca** dla *tego* refaktoru formalnie najbardziej core i najsłabiej egzekwowany niezmiennik ("brak konceptów → zero propozycji", I1) — bo nie ma kształtu "spójność trwałego stanu agregatu" (propozycja nigdy nie jest persystowana przed accept) — i rekomenduje dla niego osobny harness ewaluacyjny w CI, nie wzorzec Aggregate/Repository. I2+I3 należy do agregatu **`Deck`** (korzeń): reguła unikalności jest zdefiniowana per talia, tylko `Deck` zna pełny zbiór swoich kart bez zapytania cross-agregatowego.

**Anti-Corruption Layer:** `ts-fsrs` przecieka przez **3 warstwy produkcyjne** — `lib`, API, UI klienta — niejednolicie: `lib` importuje go **bezpośrednio**; API zależy od niego **pośrednio**, przez `src/lib/fsrs.ts`; UI zależy od niego **zarówno bezpośrednio, jak i pośrednio** (bezpośredni import w komponencie `client:load` + pośrednio przez `lib`). Efekt: dwie niezależne instancje silnika, trzy rozbieżne rekonstrukcje kształtu danych FSRS. Projekt ACL: value object `ReviewSchedule` + port `SchedulingEngine` + adapter `FsrsSchedulingEngine` jako jedyny plik importujący `ts-fsrs` bezpośrednio; kluczowa decyzja — przeniesienie podglądu interwałów z przeglądarki na serwer, eliminując jedyny powód obecności biblioteki po stronie klienta. Kryterium sukcesu: `grep -rn "ts-fsrs" src/` zwraca wyłącznie plik adaptera.

## 6. Decyzje, które należą do mnie

**Rekomendacje AI (agent 10xArchitect):**
- Zidentyfikował I1 jako niezmiennik o najwyższym ryzyku produktowym, ale zaproponował go **wyłączyć** z zakresu refaktoru agregatowego — wzorzec Aggregate/Repository nie pasuje do problemu jakości osądu niedeterministycznego modelu.
- Zaproponował połączony **I2+I3** jako lepszy cel ćwiczenia Aggregate/Repository.
- W L4 zaproponował **C4** (strukturalne wymuszenie capability-check + test pairing) jako główny kierunek refaktoru, po zestawieniu z mniejszą alternatywą — samym guardem bez strukturalnego wymuszenia (bez reguły lintera/CI).

**Moje decyzje (przegląd i akceptacja):**
- Przejrzałem trade-off I1 vs I2+I3 wg trzech kryteriów — krytyczność, rozproszenie w kodzie, możliwość wymuszenia wzorcem — i zaakceptowałem I2+I3 jako cel ćwiczenia agregatowego, a dla I1 osobną inicjatywę (harness ewaluacyjny) zamiast Aggregate/Repository.
- W L4 potwierdziłem C4 jako główny kierunek po zestawieniu z alternatywą "sam guard bez wymuszenia".
- Nie zatwierdzałem jeszcze zmian kontraktu API (`GET /review` z polem `preview`) ani zmiany istniejącego kontraktu testowego `cards-batch-insert.test.ts`; oba plany pozostawiają te decyzje jawnie do potwierdzenia przed ewentualną implementacją.
