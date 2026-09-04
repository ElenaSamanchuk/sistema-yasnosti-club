# Система ясности — Аудиоклуб (блок для Тильды)

Страница аудиоклуба «Почему ты такой» (Vue 3 + Tailwind, присланная одним html-файлом), переупакованная для вставки на Тильду одним блоком **HTML-код (T123)**. Меню и футер — на стороне Тильды, в блоке их нет.

## Ссылки

- Превью (GitHub Pages): https://elenasamanchuk.github.io/sistema-yasnosti-club/
- Ассеты (jsDelivr): `https://cdn.jsdelivr.net/gh/ElenaSamanchuk/sistema-yasnosti-club@main/assets/`
- Сайт клиента: https://sistemayasnosti.com (Тильда, меню T228 fixed 59px — якоря страницы рассчитаны на него)

## Вставка на Тильду

1. Откройте страницу в редакторе Тильды.
2. Добавьте блок **HTML-код (T123)**.
3. Вставьте **целиком** содержимое файла [`tilda/sya-audioclub-tilda.html`](tilda/sya-audioclub-tilda.html) (~150 KB: шрифты, стили, разметка, скрипт; картинки грузятся с jsDelivr).
4. Отступы блока в настройках Тильды — 0 сверху и снизу.
5. Опубликуйте страницу.

Лёгкий вариант — [`tilda/sya-audioclub-tilda-external.html`](tilda/sya-audioclub-tilda-external.html) (~1 KB): CSS и JS подгружаются с jsDelivr. Работает только после пуша в `main`; jsDelivr подхватывает файлы за 2–10 минут.

Важно: после каждой пересборки заново вставьте код в блок T123 и опубликуйте страницу — имена файлов в CDN содержат хеш содержимого.

## Что сделано с присланной страницей

- убраны `<header>` (меню) и `<footer>`, у корня снят `min-h-screen`;
- 8 картинок из base64 (1,4 МБ) → WebP на jsDelivr (~430 KB), hero и печать пластинки — с `preload`, остальные `loading="lazy"`;
- CSS Tailwind снят с `@layer` и целиком обёрнут в `.sya` — стили не протекают на блоки Тильды, а её глобальные правила не ломают блок;
- JS без `type="module"`, в IIFE (никаких глобальных `const` рядом с jQuery Тильды), точка монтирования `#sya-club-app`;
- плеер в hero: кнопка play/pause, музыка стартует только по клику, точка прогресса и волна двигаются во время воспроизведения. Трек — Эрик Сати, «Гимнопедия №1», фортепиано Robin Alciatore, public domain (Musopen / Wikimedia Commons), `assets/audio/satie-gymnopedie-1.mp3` (3,3 МБ, грузится только после нажатия play);
- плавное появление блоков и элементов при прокрутке (IntersectionObserver, уважает `prefers-reduced-motion`);
- неразрывные пробелы после предлогов/союзов (встроенный типограф) и снятие точек в конце абзацев;
- «Теперь будет иначе», пункт 03 — описание уже, чтобы «теория» переносилось.

## Обновление контента

1. Новый файл от разработчика положить в `source/` (имя с датой, например `audioclub-2026-09-10.html`).
2. Собрать:

```bash
cd ~/Projects/sistema-yasnosti-club && node scripts/build-tilda.mjs --music=assets/audio/satie-gymnopedie-1.mp3
```

Опции: `--bot=https://t.me/…` (ссылка на бота вместо плейсхолдера), `--music=assets/audio/файл.mp3` (mp3 вместо генеративного эмбиента), `--ref=<sha>` (закрепить CDN на коммите), `--clean` (удалить старые версии файлов).

3. Закоммитить и запушить в `main`, затем заново вставить `tilda/sya-audioclub-tilda.html` в T123.

Скрипт падает с понятной ошибкой, если структура присланной сборки поменялась (имена компонентов, разметка плеера) — тогда нужно обновить регулярки в `scripts/build-tilda.mjs`.

## Локально

```bash
cd ~/Projects/sistema-yasnosti-club && npx serve -l 5567 .
```

http://localhost:5567 — превью `index.html`. Для проверки внутри реальной страницы Тильды: `preview-tmp/tilda-sim.html` (не в репозитории).

## Файлы

| Файл | Назначение |
| --- | --- |
| `source/*.html` | Присланные сборки (как есть) |
| `scripts/build-tilda.mjs` | Сборка: картинки, CSS-обёртка, правки JS, файлы для Тильды |
| `scripts/runtime.js` | Скрипт блока: появление, точки в абзацах, плеер |
| `assets/img/*.webp` | Картинки для CDN (имя = роль + хеш) |
| `assets/tilda/sya-audioclub.<hash>.css/js` | CSS и JS для внешнего варианта и превью |
| `tilda/sya-audioclub-tilda.html` | Один блок T123, всё inline |
| `tilda/sya-audioclub-tilda-external.html` | Блок T123, CSS+JS с jsDelivr |
| `index.html` | Превью (GitHub Pages) |

## Известные плейсхолдеры в присланной странице

- ссылки на бота в hero и в блоке «Что входит»: `https://t.me/your_bot_username` — задать через `--bot=`;
- ссылки меню/футера «Отзывы», «О создателе», «Личный кабинет» вели на `#` — в блок не входят.
