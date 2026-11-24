# Передача роботи (стан на 2026-11-24)

Прочитай спершу `CLAUDE.md` (правила й команди). Цей файл — що вже зроблено й що робити далі. Нічого не перепитуй: рішення нижче прийняті власником.

## Рішення власника
- Переписати Transly на **Rust з нативним інтерфейсом без вебвʼю**. Причина: WebView2 займає ≈745 МБ на його проєкті (105 тис. рядків, перекладено 25 тис.), потрібно швидше й менше пам'яті.
- Лише **ПК/Windows**. Телефон і браузер зняті з підтримки.
- **Одним великим кроком**: окрема робота в `rust/`, `desktop-latest` (старий Tauri-застосунок) лишається поточною збіркою, нові функції в старому застосунку на паузі, окрім виправлень за скаргами.
- Формат `project.json` **не змінюється**.

## Що зроблено
- Старий застосунок (`app/`): актуальний, усе запушено й випущено (`desktop-latest`). Останні зміни: автозаповнення збирає рядок з частин (`core/compose.ts`), права панель карточками, головне меню (друга кнопка + F10), стабільна прокрутка списку рядків, виправлення «Внески» й терміни в полі перекладу.
- **Етап 0 (прототипи) готовий.** `rust/proto-egui` і `rust/proto-slint`, порівняння в `rust/PROTO-COMPARISON.md`, збірка для Windows: Actions → «Rust prototype» → реліз `proto-latest` (обидва `.exe`).
  - egui: таблиця 100 тис. рядків ≈7 мс/кадр, поле перекладу з підкресленнями термінів і номерами працює (`TextEdit::layouter` + `LayoutJob`).
  - Slint: стилізований текст лише для показу (підкреслення/колір), редаговане поле без позначок → не підходить.
  - **Рекомендація: egui.** Остаточне підтвердження залежить від перевірки власника на Windows (ввід українською, Narrator, пам'ять). Результатів він ще не надіслав; не чекай їх, початок етапу 1 від вибору бібліотеки не залежить.

## Що робити далі: етап 1 — ядро `transly-core`
Мета: перенести `app/src/core/*.ts` (≈11,6 тис. рядків чистої логіки без DOM) у Rust-бібліотеку `rust/transly-core` із **тією самою поведінкою**.

1. **Каркас.** Додай `transly-core` до `rust/Cargo.toml` (`members`). Залежності: `serde`, `serde_json`; без UI.
2. **Золоті вектори (еталон).** Створи `app/scripts/export-vectors.ts` (запуск через `vitest` або `tsx`), який для кожного модуля викликає TS-функції на наборі входів (взятих з наявних тестів і додатково випадкових із фіксованим seed) і записує `{input, output}` у `rust/transly-core/tests/vectors/<модуль>.json`. Rust-тести (`tests/*.rs`) читають ці JSON і вимагають **точної рівності**. Так 1500+ TS-тестів лишаються еталоном.
3. **Порядок модулів** (за залежностями): `model` → `project` (формат даних, `serde` сумісний зі старим JSON) → `merge` (злиття записів v2, tombstone, закони комутативності/асоціативності/ідемпотентності) → `journal`/`plan` (пакети змін, скасування) → `glossary`, `termmatch`, `strands`, `termusage` → `qa*` та правила → `ukmorph`, `termsync` → `autofill`, `compose`, TM → `ingest` → `branches` → формати файлів (RPG Maker JSON, gettext, CSV, Ren'Py) і збірка (`build`, `wrap`) → `ext/*` (плагіни, мовні пакети).
4. Після кожного модуля: `cargo test`, `cargo clippy -- -D warnings`, коміт українською, пуш. Один модуль — один коміт.
5. Не чіпай `app/src/ui` і старий застосунок без скарги власника.

## Етапи після 1 (коротко, деталі в `CLAUDE.md`)
2. Платформа: `app/src-tauri/src/lib.rs` → Rust-крейт `transly-platform`.
3. Інтерфейс на egui по екранах, тести інтерфейсу (`egui_kittest`), паритет, інсталятор, випуск.

## Підводні камені
- Тримай теку проєкту **поза OneDrive**; `target/` займає гігабайти.
- Windows: потрібні Rust (`rustup`) і Build Tools для Visual Studio.
- У `app/src/core` є тонкі місця, які тести фіксують: порядок злиття, `nextMt` (гібридний годинник), поділ слів `tokenize`, правила `ukmorph` (відмінювання). Не «покращуй» поведінку при перенесенні: спершу еквівалентність, потім зміни.
- Не змінюй `desktop.yml` і `test.yml` без потреби.

## Прогрес етапу 1 (оновлено)
- Готово й запушено: `rust/transly-core` — модулі `model`, `variants`, `workflow` (без `submit`/`approveEntry`: потребують QA і `wrap`), `merge`. Вектори: `cd app && npm run vectors` → `rust/transly-core/tests/vectors/merge.json`; тести: `cd rust && cargo test -p transly-core`.
- Нове вектори для модуля = новий файл `app/scripts/vectors/<модуль>.vec.ts` (допоміжне — `util.ts`: seeded rng, `text()` з символами для розбіжностей UTF-16/UTF-8) + `rust/transly-core/tests/<модуль>_vectors.rs` (допоміжне — `tests/common`).
- Правила перенесення: рядки порівнювати через `js::cmp` (UTF-16), `JSON.stringify` → `js::stringify`, хеші — `js::hash_text`. Порядок полів структур = порядок, в якому TS будує об'єкти.
- Також готово: `plural` (вибір форми й групування тисяч; підключення до i18n — з `ext/i18n`), `ukmorph` (повністю, словник `MorphDict` — трейт, у векторах не використовується). Вектори `ukmorph.json`: 1500 фраз, 4000 перенесень.
- Також готово: `controlcodes`, `hyphen`, `wrapconfig` (разом із `gamewindow`), `wrap` (функція виміру в пікселях — `Option<Measure>`, її дає виклик; `js::is_space`/`js::trim` тепер як `s` у JS).
- Також готово: `qacodes`, `qarules` (8 власних правил; правила плагінів — з `ext/*`), `qaconfig`, `qa`, `qaadvice`, а також `submit`/`approve_entry` у `workflow`. Кеші по об’єкту рядка (`WeakMap`) не переносилися. Залежності: `fancy-regex`, `unicode-normalization`. Позиції в правилах — індекси символів, не UTF-16.
- Відомо: 6 тестів `test/ext-examples.test.ts` падають на Windows через контрольні суми (CRLF) — не пов’язано з ядром.
- Також готово: `progress`, `validate` (ремонт і обмеження годинника), `project` (формат `project.json`, розбір із ремонтом, `merge_projects`), `branches` (без `diffBranches`/`planMerge`), частини `groups` і `links` (лише злиття).
  - Проєкт у Rust: типізовані `files` (рядки з `extra` для невідомих полів), решта — `serde_json::Value` з порядком ключів файлу; невідомі поля верхнього рівня — `extra`.
  - Відхилення від TS: дробові часові мітки (`mt`, `at`…) при читанні відкидають дробову частину (`js::lenient_i64`); `sourceLang`/`targetLang` не рядок → типові `en`/`uk`; порядок ключів у `base` гілок, створених у Rust, — порядок структур (лише для нічиїх при злитті двох різних `base`).
- Також готово: `autolog`, `autofill` (токенізація, навчання слів, пропозиції, «майже»), `compose` (складання рядка з частин). `FileView` тепер один — у `project`, `journal` його реекспортує.
- Також готово: `tm` (подібність за Левенштейном, індекс пам’яті; таблиця слів — на індекс, не глобальна), `ingest` (вирівнювання Майєрса, перенесення перекладів між версіями гри).
- Також готово: `scene`, `sceneindex`, `speakers`, `groups` (повністю), `links` (повністю), `collate` (порівняння рядків як `localeCompare` через ICU4X: `locale_compare_uk`, `locale_compare`; збігається з Node на іменах з ґ/ї/є/і).
  - Групи й зв’язки — `serde_json::Map` зі значеннями-`Value` (порядок ключів і невідомі поля зберігаються). `GroupData::of(&project)` / `.apply(&mut project)`. Випадкову частину id групи дає виклик (`rand_suffix`).
  - У `LinkView` рядки `self`/`reference`/`main` — індекси в `rows` (у TS — посилання).
- Далі за списком: `branches` (порівняння), формати файлів і збірка (`engine`, `rpgmaker`, `build`, gettext/CSV/Ren'Py), `ext/*`, решта дрібних модулів (`stamps`, `outbox`, `inbox`, `queue`, `sync`, `filesync`, `dbsync`, `github`, `reference`, `sysnames`, `termsync`, `termtable`, `termedit`, `variants`-UI, `jump`, `mine`, `pages`, `plugins`, `theme`, `undostack`, `undosend`, `textdiff`, `historyview`, `comments`, `projname`, `store`, `zip`).
