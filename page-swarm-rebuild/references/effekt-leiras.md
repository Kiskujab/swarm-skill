# Az effekt pontos leírása: az oldal újraépíti magát egy kurzor-rajjal

**Forrás.** Egy 56,5 mp-es Instagram-reel (1088×1936 px, 30 kocka/mp, álló kamera). Egy laptop képernyőjét filmezték telefonnal (nem képernyőfelvétel), Chrome-ban, a `localhost:5500/#home` címen futó oldalon. Az első ~21 mp-et 0,07–0,5 mp-es lépésekkel néztem végig (a nyitány első 2 mp-ét minden második kockán), a többit 1,5 mp-es lépésekkel (ott az időpontok ±1 mp-esek). A görgetést a görgetősáv csúszkájából mértem minden kockán. A hangot nem vettem figyelembe.

**Jelölések.** [LÁTOTT] = a kockákon közvetlenül látszik. [FELTÉTELEZÉS] = következtetés, a videó nem mutatja meg. A színek és méretek a képernyőt filmező kamerából becsültek, ezért csak közelítők.

> **Ez a videó leírása, nem a termék specifikációja.** Ahol a skill (SKILL.md) mást mond, az a mérvadó. A leírás óta született döntések és eltérések:
> - **Hang nincs.** A videón látható hangszóró-gomb kimaradt, a modulban nincs hangkód.
> - **A vezérlősáv nem alul középen van**, hanem a jobb szélen (kompakt, összecsukható; `controlsPosition: right | left | bottom`), mobilon egy kis fül egy szabad sarokban, ami nem takarja a fix sávokat, telefonszám-linkeket és gombokat.
> - **Az ügynökök a nézetet követik:** csak a látható részt és legfeljebb fél képernyőnyit alatta építenek. Kézi görgetésre a tour leáll, és az építés oda megy, ahová a látogató néz (lásd 8.2 és 8.7).
> - **Termékdöntés:** a fő mód a látogató görgetése által hajtott `scroll`; a vezérlősáv és a tour csak teszt- és felvételi eszköz. (A modul v1.0.1-ben a sáv még minden módban látszik, ennek kikapcsolása a következő körök feladata.)
> - A demón 214 réteg van (a v1.0.1 előtt 212) 6,6 képernyőnyi oldalon (a videón 364 réteg, 7,1 képernyő).

---

## 0. Röviden (ezt olvasd el először)

- Ez **nem görgetésre induló effekt**. Ez egy "az oldal újraépíti magát" előadás: a kész oldal elrejtőzik, majd 18 (a végére 30) színes kis egérkurzor, ügynök (agent) elemről elemre újraépíti. Úgy dolgoznak, ahogy egy többszemélyes tervezőprogramban (Figma-féle) dolgoznának: keretet húznak, szöveget gépelnek, képet töltenek be, elemet másolnak és sorba igazítanak.
- Közben az oldal magától, lassan legörög oda, ahol épp a munka folyik. A vezérlősáv ezt "Tour"-nak hívja.
- Alul egy kis vezérlősáv (HUD: a képernyőn lebegő kijelző) mutatja az állást: `23 agents | 112 / 364 layers`. A "layer" (réteg) az oldal egy eleme: szövegblokk, kép, gomb, kártya, lista-sor, ikon, vonal.
- A végén a sáv ezt írja: `Rebuilt by 30 agents in 51.4s`, két gombbal (`Go live`, `Replay`), a kurzorok pedig gyűrűbe állnak.
- A végeredmény pontosan az eredeti oldal. Az effekt csak megmutatja az építést, új tartalmat nem hoz.

## 1. Ami NEM az effekt része (a felvétel "zaja")

1. **Windows tálca-előnézet.** A vezérlősáv mellett (kb. 1,3–2,8 s) megjelenő kis kártya az oldal címével és az oldal miniatűrjével, valamint a "Show hidden icons" szöveg (kb. 3,3–5,0 s). Ezeket a valódi egér hozza fel a Windows tálcán.
2. **A valódi, fehér egérnyíl** az elején a "Tour" gombnál (0–0,7 s).
3. A böngésző felülete, a tálca, az óra, a laptop.
4. **Az oldal saját dizájnja:** a bal oldali vékony piros függőleges vonal, a fejléc "Motion off" és "Let's talk" elemei, minden szöveg és kép. A "Motion off" valószínűleg az oldal saját "kevesebb mozgás" kapcsolója. Az effektnek tiszteletben kell tartania (és a `prefers-reduced-motion` beállítást is).

## 2. A videó adatai és hogyan nézd át te is

- 1088×1936 px, 30 kocka/mp, 1694 kocka, 56,47 mp. Kocka = másodperc × 30.
- A böngésző tartalma a kockán kb. x=90..1020, y=690..1190 → `crop=930:500:90:690`.
- Kockák kivágása (az `fNNNN.jpg` az (NNNN−1). kocka):
  `ffmpeg -i VIDEO.mp4 -vf "crop=930:500:90:690" -q:v 3 frames/f%04d.jpg`
- Kontaktlap (6 kocka egy képen, a 0–50. kocka 10-esével):
  `ffmpeg -i VIDEO.mp4 -vf "crop=930:500:90:690,select='between(n,0,50)*not(mod(n,10))',scale=760:-1,tile=2x3" -frames:v 1 -fps_mode passthrough sheet.png`
  (a régi `-vsync 0` kapcsoló az ffmpeg 5.1 óta elavult, helyette `-fps_mode passthrough` kell)
- Érdemes megnézni (kocka): **0, 20, 26, 30, 36, 40, 44, 48, 52, 56, 60, 66** (nyitány); **100–144** (menü klónozása); **150–168** (címsor gépelése és nagyítása); **266–286** (kártyák klónozása); **360–405** (logósor); **495–555** (díjlista); **795** (előtte/utána csúszka); **1155, 1335** (vonalzók újra); **1560–1690** (befejezés).

---

## 3. Időrend

### A. Szkennelés (0,00–0,95 s, kocka 0–28) [LÁTOTT]
- Fekete oldal, közepén egy alig látható sötétszürke "R" monogram (az oldal logója betöltő-képként).
- 15–16 pasztell nyíl-kurzor két külön rajban kering a monogram körül (0,0 s: egy csoport fent, egy lent; 0,33 s: jobbra fent, balra lent; 0,67 s: balra és jobbra egy-egy csomó). A csoportok együtt mozognak, tehát raj-viselkedés (flocking).
- Vezérlősáv alul középen: `Scanning page…`, mellette vékony vonal, majd gombok: `Tour`, `1×`, hangszóró, `✕`.
- A görgetősáv csúszkája a 0. kockán a lap legalján áll, néhány kockával később (legkésőbb a 10. kockára) a tetején: gyors, animáció nélküli ugrás a lap tetejére. [FELTÉTELEZÉS] A felvétel egy előző futás végén kezdődik (egy "Replay" után): az oldal lent állt, a szkennelés visszaugrasztja a tetejére.
- ≈0,6 s-nál a `Tour` gomb kékre vált, `Touring` lesz (a valódi egér 0,3 s-nál ráhúz, rákattint). [FELTÉTELEZÉS] A Tour gomb indítja a végigvezetést (építés + automata görgetés).

### B. Szétrajzás (0,85–1,05 s, kocka 26–31) [LÁTOTT]
- A rajok szétrobbannak a vászon bal és jobb szélére, nagyon gyorsan (5–6 kocka alatt 300–400 px a felvételen), 3–4 halvány utánképpel. Ezért látszanak "×" és "+" alakú csíkok a kockákon.
- A bal és a felső szélen vonalzók (ruler) jelennek meg: vékony csík, számokkal (100, 200…). Kb. 0,85–2,3 s között látszanak.
- ≈0,97 s: a vezérlősáv átvált: 5 átfedő színes avatar-kör + `18 agents | 0 / 364 layers` + vékony vonal + `Touring` + `1×` + hang + `✕`.

### C. Váz-építés, "blocking" (1,05–1,55 s, kocka 31–46) [LÁTOTT]
- A kurzorok keresztszálkává (+) alakulnak, és vonszolva egy-egy téglalapot húznak fel a bal-felső saroktól a jobb-alsóig. A téglalap húzás közben nő (a nagy hős-képkeret 1,1 s-tól 1,4 s-ig ér el teljes méretet, a növekedés közben 1–2 halvány utánképpel).
- Minden keret: 1 px élénk kék körvonal, fehér négyzet-fogantyúk a sarkokon (nagy kereteknél az oldalak közepén is), alatta cián téglalap-címke a méretével (`108 × 46`), ami húzás közben élőben változik.
- A képek helye: nagy, áttetsző kékesszürke téglalap, közepén kis kép-ikon. A szövegek helye: üres, kék körvonalú doboz, mellette fehér I-beam kurzor. A gomb helye: kékesszürke téglalap.
- Szaggatott világoskék segédvonalak (guides) futnak át az egész vásznon, az elemek éleihez igazítva. A vonalzókon élénk kék sáv jelzi a kijelölt elem kiterjedését.
- Számláló: 0 / 364.

### D. Kitöltés (1,35–3,0 s, kocka 40–90) [LÁTOTT]
- **Szöveg gépelése:** villogó függőleges kurzor (caret) halad, a betűk a végleges színükben jelennek meg (pl. "EDITOR & VFX ARTIST" pirosan). Sebesség kb. 60–120 karakter/mp (a "KARYA YANG BICARA" 17 karaktere ~0,2 s alatt, hosszú bekezdések gyorsabban, 2–5 karakter/kocka). A szövegdoboz kék körvonalas, a jobb szélén fehér I-beam áll.
- **Nagy címsor:** először kicsiben jelenik meg/gépelődik a dobozban, aztán a doboz sarkát meghúzva nagyra "nő" (0,2–0,3 s alatt), közben 1–2 halvány utánkép marad mögötte, és a méret-címke vele együtt számol. Példa: a hős-név 1,47 s-tól 1,87 s-ig nő ~78 px-ről ~220 px szélesre a felvételen; a "KARYA YANG BICARA" címsor 5,33–5,6 s között.
- **Gomb:** a kékesszürke kitöltés 1–2 kockán belül átvált a végleges piros színre, utána kerül bele a felirat.
- **Háttérbetűk:** a nagy piros "PORTFOLIO" felirat 1,67–1,73 s között egyszerre villan be (nem gépelődik). A kékesszürke képkeret részben eltakarja.
- **Kép:** lásd 4.6 (a portré 1,9–2,2 s alatt "előhívódik").
- **Számláló:** 2 (1,6 s), 7 (1,8 s), 10 (2,0 s), 20 (2,7 s), 32 (3,0 s).

### E. A hős többi eleme és a menü (3,0–5,0 s) [LÁTOTT]
- Fejléc-elemek (`Motion off`, `Let's talk ↗`), a jobb oldali számok (`3.`, `18.`, `10.` kis címkékkel; a második szám 3-ról 18-ra íródik át), `DOWNLOAD CV`, alul `PLAY SHOWREEL` (kör play-ikonnal), `SCROLL TO DISCOVER`, `SELECTED WORK / 2022–2026`.
- **Menü (3,3–4,8 s):** az első menüpontot ("Karya") megépítik, majd **klónozzák** (lásd 4.7): 3 másolat piros körvonallal és piros számcímkékkel (pl. `104`, `182`) egy vízszintes piros vonal mentén, egyenletes közzel csúszik jobbra. Aztán mind a 4 szövegét egymás után (kb. 0,13 s eltolással) átírják: Awards, Tentang, Perjalanan, Kontak.
- A hős kész ≈4,8 s-ra: 54 / 364.

### F. Végigvezetés (Tour): szakaszról szakaszra (≈3,7–52,2 s) [LÁTOTT, a 15 s utáni részek ritkább mintával]
A szakaszok általában ugyanazt a sorrendet követik: **címke → címsor (gépelés + nagyítás) → elválasztó vonal → nagy keretek → tartalom → apró elemek.** A számláló értékei közelítők.

| Idő (s) | Szakasz | Mi épül | Réteg-szám |
|---|---|---|---|
| 1,05–4,8 | Hős | címkék, nagy címsor, portré, gomb, számok, menü | 0 → 54 |
| 5,0–7,9 | "Selected work" fejléc | címke, címsor (gépelés 5,07–5,27 s, nagyítás 5,33–5,6 s), vonal, "összes munka →", kereső, 9 szűrő-gomb (klónozva, átírva) | 55 → 92 |
| 7,9–10,5 | Galéria (3 kártya) | az 1. kártya: placeholder → kép (8,2–8,5 s); 2 klón elcsúszik jobbra (9,0–9,5 s), majd tartalom-csere | 92 → 104 |
| 10,5–15 | Logósor | címsor gépelve; 1 logó, 6 klón egy narancspiros vonal mentén (12–13 s), logó-csere (13–13,5 s): összesen 7 logó; "összes (18)" link, lapozó nyilak | 104 → 134 |
| 15–22 | Díjak | címke, kétsoros címsor (2. sor piros), "10+" szám két piros babérággal, bekezdés, link, a lista 6 sora (1. gépelve, 5 klón, évszámok átírva) | 134 → 170 |
| 22–29 | "From raw. to real." | címke, kétsoros címsor, nagy médiakeret két címkével ("SOLID VIEW" / "FINAL RENDER"), középen függőleges osztóvonal és piros kerek fogantyú (előtte/utána csúszka), kép (26,5 s), bekezdés és felirat gépelve | 170 → 194 |
| 29–38,5 | "Behind the frames" | címke, kétsoros címsor, jobb oszlopban bekezdés, oktatás-lista, számozott idővonal (5 pont, függőleges vonal), piros idézet-kártya, eszköz-gombok és szoftver-ikonok (klónozva) | 194 → 267 |
| 38,5–44 | "The journey" | címke, címsor, hosszú vékony piros függőleges vonal és kék vízszintes vonal (vonalzók újra látszanak 38,5 s-nál), a bejegyzések klónozva, "milestones" lista | 267 → 318 |
| 44–52,2 | "Your next story" | nagy vonalzó + kék sáv 44,5 s-nál, címsor, bekezdés, gomb, 4 kapcsolat-sor (klónozva), sötét médiakártya piros play-gombbal, lábléc-logó (utolsó) | 318 → 364 |

### G. Befejezés (52,2–56,5 s, kocka 1565–1693) [LÁTOTT]
- ≈52,2 s: a vezérlősáv átvált (a 362 / 364-ről): `Rebuilt by 30 agents in 51.4s`, teli kék vonal, hangszóró, **`Go live`** (élénk kék, kitöltött) és **`Replay`** (sötétszürke), `✕`. A `1×` gomb eltűnik.
- A kijelölő keretek, vonalzók, segédvonalak eltűnnek. A görgetés az oldal alján áll (51 s óta).
- A kurzorok 52,3 s-tól a jobb felső sarok felé özönlenek, 53,5–54 s között több csoportban kavarognak (utánképekkel), 55–56,3 s között **gyűrűbe rendeződnek** a sötét médiakártya körül: 30 kurzor kb. 300 px sugarú körön, a kör érintője irányába fordulva. A videó itt ér véget, ezért nem látszik, hogy a gyűrű forog-e. [FELTÉTELEZÉS] lassan forog, amíg valaki a `Go live`-ra nem kattint.
- A teljes futás ideje a sáv szerint 51,4 s; ez a 0,97 s-os építés-kezdéstől 52,4 s-ig számít, tehát a szkennelés nem része.

---

## 4. Vizuális építőelemek

### 4.1 Az ügynök-kurzor
- **Alak:** kis nyílhegy, "papírrepülő": lekerekített háromszög, hátul V-bemetszéssel, vékony világos szegéllyel. Hossza kb. 22–26 px egy ~1500–1900 px széles nézetben (a normál kurzor ~1,5-szerese).
- **Színek (becsült, pasztell):** türkiz `#5fd6e8`, rózsaszín `#f4a3b8`, barack `#f6c48d`, levendula `#a99cf5`, égkék `#6aa7ff`, menta `#8fe3b5`, fehér. Minden ügynöknek saját színe van.
- **Irány:** mozgás közben a haladási irányba fordul (mint egy repülő), lebegés közben a hagyományos kurzor-irányba áll (hegye balra-fel).
- **Utánkép:** gyors mozgáskor 2–4 egyre halványabb másolat követi. Ezért látszik a felvételen "▶▶▶" és "×" csík.
- **Három üzemmód:** (a) nyíl: mozgatás/kijelölés; (b) pasztell keresztszálka "+": keretet húz; (c) fehér I-beam: szöveget ír (ilyenkor a szövegdoboz jobb szélén áll egy fehér I-beam).
- **Pihenő állapot:** ha nincs feladatuk, 10–15 kurzor lassan sodródik a nézet üres részein (főleg a jobb oldalon), néha egyszerre irányt váltva.
- **Nem láttam:** név-címkét a kurzor mellett, kattintás-gyűrűt.

### 4.2 Kijelölő keret, fogantyúk, méret-címke
- 1 px élénk azúrkék körvonal (≈`#2f8fff`), fehér, ~8 px négyzet-fogantyúk a sarkokon (és az oldalak közepén nagy kereteknél).
- Alatta, középen cián (≈`#28d6ee`) lekerekített téglalap-címke, apró félkövér számokkal: `szélesség × magasság` (pl. `46 × 17`, `1521 × 66`). Húzás közben élőben frissül.
- A kijelölés a réteg elkészültekor tűnik el. [FELTÉTELEZÉS] A réteg-számláló ekkor nő eggyel.

### 4.3 Segédvonalak és vonalzók
- Segédvonalak: 1 px szaggatott világoskék vonalak az egész vásznon, az elemek éleihez és középvonalához igazítva, főleg a váz-építés alatt.
- Vonalzók: a bal és a felső szélen vékony sáv számokkal; a kijelölt elem kiterjedését élénk kék sáv (≈`#128bcf`) jelzi. Akkor jelennek meg, amikor nagy, szakasz-szintű keretet húznak (0,85–2,3 s, 38,5 s, 44,5 s).
- Vonal-rajzolás: a szakasz-elválasztó vonalat (és az idővonalakat) egy ügynök balról jobbra húzza ki kék vonalként, a végén kerek ponttal (5,33 s-tól látszik). [FELTÉTELEZÉS] A kék vonal később elhalványodik vagy eltűnik, a kész oldalon csak az oldal saját, halvány elválasztója marad.

### 4.4 Placeholderek
- Kép/média: áttetsző kékesszürke téglalap (≈`#5a7fa8`, 40–60% fedéssel a sötét háttéren), közepén kis kép-ikon.
- Szöveg: csak körvonal (nincs kitöltés).
- Gomb/kártya-háttér: ugyanaz a kékesszürke, utána a végleges színre vált.

### 4.5 Szöveg
- Kisebb szöveg: gépelés caret-tel, 60–120 karakter/mp.
- Nagy címsor: kicsiben legépelve, majd a keret sarkát húzva nagyra nő (4.2-vel), a méret-címke közben számol. A címsor gyakran két színű (az utolsó szó vagy a 2. sor piros).
- Évszámok/számok: átíráskor a régi és az új számjegy rövid ideig (2–3 kocka) egymásra csúszik, nem vált azonnal.

### 4.6 Kép és média felfedése
- Hős-portré: a placeholder fölött a kép 1,9–2,2 s alatt "előhívódik": először csak a fej halványan látszik, aztán felülről lefelé halad egy felfedés (maszk), közben a kékesszürke fátyol eltűnik. Kb. 0,3 s alatt teljesen éles.
- Galéria-kép: a placeholderből 8,2 és 8,5 s között (kb. 0,3 s) bukkan fel a kép; a köztes kockákat nem néztem külön.
- Tartalom-csere (klónozás után, 9,7–10,5 s között): a másolt kép elsötétül és elmosódik, majd az új kép kiélesedik. A pontos időzítést nem mértem.

### 4.7 Klónozás és átírás (a leggyakoribb minta) [LÁTOTT]
Ahol az oldalon ismétlődő elemek vannak (menü, szűrő-gombok, kártyák, logók, lista-sorok, idővonal-pontok, kapcsolat-sorok, számok), **csak az elsőt építik meg**, a többit másolják:
1. A kijelölt elsőről piros körvonalú másolat válik le, az ügynök(ök) megfogják.
2. A másolat(ok) egy vízszintes piros vonal mentén egyenletes közzel elcsúsznak a célhelyre: 2–3 halvány utánképpel, vízszintes elmosódással (kártyáknál 9,0–9,5 s, ~0,4 s alatt). Piros számcímkék jelzik a távolságot (pl. `104`, `182`, `256`).
3. A másolatok célhelyükön kék kijelölést kapnak (fogantyúk, cián méret-címke).
4. Minden másolat tartalmát átírják: a szöveget kijelölik és új szöveget gépelnek (menü: ~0,13 s eltolással egymás után), a képet kicserélik (4.6), az évszámot átírják (4.5).

### 4.8 Egyéb jelenségek
- Előtte/utána csúszka: középen függőleges osztóvonal, rajta piros kerek fogantyú; fent két címke ("SOLID VIEW", "FINAL RENDER"). Ez az oldal saját funkciója.
- Díjak: a "10+" szám két piros babérág-ikon között áll, az ikonokat külön elemként építik.

---

## 5. A vezérlősáv (HUD)

**Hely és kinézet:** a nézet aljához rögzített (fixed), vízszintesen középre igazítva, az alsó szélnél kb. 24 px-rel feljebb. Kb. a nézet szélességének harmada (≈450–550 px), 44–52 px magas, lekerekített (≈14 px) "pirula" (a gombok ≈28 px-es lekerekített négyzetek): sötét, áttetsző navy háttér (≈`#131a27`, ~85%), vékony világosabb szegély, homályosítás (backdrop blur), világos szöveg ~11–12 px-es sans-serif betűvel. Nem mozdul görgetéskor.

**Állapotok (balról jobbra):**
1. **Szkennelés:** `Scanning page…` | vékony vonal | `Tour` (sötétszürke gomb) | `1×` | hangszóró | `✕`.
2. **Építés:** 5 átfedő színes avatar-kör (az ügynökök színei) | `18 agents` | `0 / 364 layers` | vékony vonal (szürke sín, kék kitöltés, a réteg-számláló arányában) | `Touring` (áttetsző kék gomb, világoskék szöveggel, ≈`#1b5485`) | `1×` | hangszóró | `✕`. A gombok sötétszürke, lekerekített négyzetek.
3. **Kész:** `Rebuilt by 30 agents in 51.4s` | teli kék vonal | hangszóró | **`Go live`** (élénk kék, ≈`#1f8fe8`, kitöltött) | `Replay` (sötétszürke) | `✕`. Nincs `1×`.

A szám (`N agents`, `X / 364 layers`) folyamatosan frissül.

---

## 6. Automata görgetés (Tour) [LÁTOTT, mérve]

A görgetősáv csúszkájából mérve (a lap kb. **7,1 nézetmagasság** hosszú; a görgethető út ~6,1 nézetmagasság):

| Idő (s) | 4 | 8 | 10 | 20 | 30 | 40 | 50 | 51 → vége |
|---|---|---|---|---|---|---|---|---|
| Haladás (0 = tető, 1 = alj) | 0,01 | 0,10 | 0,16 | 0,34 | 0,59 | 0,77 | 0,98 | 1,00 |

- **Indul:** ≈4 s-nál (a hős utolsó elemeinél). **Megáll:** az oldal alján, 51 s-tól.
- **Alapsebesség:** kb. 1,5%/mp a teljes úton (≈0,09 nézetmagasság/mp), vagyis lassú, egyenletes kúszás.
- **Gyorsítások:** kb. 8,5 s, 20,5 s, 26–29 s, 38–40 s, 44 s, 50 s körül a sebesség 2,5–3× (≈4%/mp), 1–3 s-ig, finoman be- és kifutva (ease-in-out). Mindig akkor jönnek, amikor a következő szakasz váza az ablak aljához ér.
- **Hol dolgoznak:** a munkaterület többnyire a nézet alsó harmadában van, a vezérlősáv fölött. [FELTÉTELEZÉS] A görgetés a "munka-frontot" követi: a legalsó aktív réteg mindig a nézetben marad.
- A vezérlősáv, a vonalzók és a kurzorok viewport-hoz rögzítettek; az építés közben az oldal tartalma görög alattuk.

---

## 7. Ügynökök és ütemezés [LÁTOTT, a HUD-ról leolvasva]

| Idő (s) | 1,0 | 2,0 | 3,0 | 4,0 | 5,0 | 6,0 | 8,0 | 10,0 | 15,0 | 20,0 | 25,0 | 30 | 35,5 | 40,0 | 45 | 50,5 | 52,2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Kész réteg | 0 | 10 | 32 | 41 | 55 | 65 | 92 | 95 | 134 | 165 | 180 | ~200 | 236 | 281 | ~320 | 355 | 364 |

- **Ügynök-szám:** 18 (1,0–5,4 s) → 19 (5,6 s) → 23 (9,9 s) → 24 (17 s) → 25 (29,5 s) → 28 (31 s) → 29 (40 s) → 30 (49 s). Lépcsősen nő, főleg szakasz-váltásoknál.
- **Átlag:** ~7 réteg/mp (364 réteg / 51,4 s). Ez nem állandó: 0–10 s ~9,5/mp; 20–30 s csak ~3,5/mp (a nagy médiakeret szakasza); 30–50 s ~7/mp.
- Egy réteg élete (keret → tartalom → kész) tipikusan 0,4–1,2 s. Egyszerre ~10–15 ügynök dolgozik látható feladaton, a többi pihen vagy a következő szakaszt készíti elő.
- A szakasz-szintű és nagy keretek az elején (1,05–1,5 s) egyszerre készülnek; a tartalom (szöveg, kép) utánuk, párhuzamosan töltődik be.

---

## 8. Nyitott kérdések és javasolt alapértelmezések

A videó ezeket nem mutatja meg. Ahol nem derül ki, ezeket használd, és jegyezd fel a jelentésben.

1. **Mi indítja az építést?** Nem látszik. Alap: oldalbetöltés után automatikusan (0,8 s szkennelés), opcióként gombról vagy URL-paraméterrel (`?rebuild=1`).
2. **Mit csinál a Tour, ha ki van kapcsolva?** Alap: nincs automata görgetés; az ügynökök a nézetben és az alatta lévő ≤1 nézetmagasságnyi rétegeket építik, a látogató görgethet, és az építés követi. (Ez a "görgetésre induló" változat, amit eredetileg kerestünk.) **A skillben:** legfeljebb 0,5 nézetmagasság a nézet alatt; ha a látogató üres részre görget, az indul először, gyorsabban és több ügynökkel.
3. **`1×` gomb:** valószínűleg sebesség-váltó (1× → 2× → 4× → 1×), minden animációs időzítést skáláz.
4. **Hangszóró:** valószínűleg effekt-hangokat (gépelés, kattintás) kapcsol. A hang nem része ennek a leírásnak. **Döntés: a termékben nincs hang, a gomb is kimaradt.**
5. **`✕`:** megszakít, azonnal megmutatja a kész oldalt, a sáv eltűnik.
6. **`Go live`:** kilép az előadásból, a sáv eltűnik, az oldal normálisan használható. **`Replay`:** újraindítja (a lap tetejére ugrik, `Scanning page…`).
7. **Használható-e az oldal építés közben?** Nem látszik. Alap: a rétegek nem kattinthatók, a kézi görgetés megszakítja a Tourt (az ügynökök tovább dolgoznak). **A skillben:** kézi görgetés után az építés scroll módban folytatódik ott, ahol a látogató van; a `Tour` gomb újraindítja onnan.
8. **A gyűrű sorsa:** nem látszik. Alap: lassan forog a `Go live` kattintásáig.
9. **Mobil/érintőképernyő:** nem látszik. Alap: kevesebb ügynök (≤8), nincs vonalzó, vagy az effekt ki van kapcsolva.
10. **Futási idő ügyfél-oldalon:** a videón az 51 mp bemutató-hossz. Valós oldalon ez túl hosszú. Alap: `speed` paraméter (1× = videó, 6× ≈ 9 s), és egy gyors mód.
