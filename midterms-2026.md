# 2026 Midterms: election list for market setup

Election day: **Tuesday, November 3, 2026**. Compiled 2026-10-19 from Wikipedia's 2026 Senate,
gubernatorial and House-ratings pages (House ratings = Cook Political Report, as of 2026-10-16).
Verify nominees against the state's certified ballot before minting a market; some fields
changed late (withdrawals, a death, an appointment).

## Launch slate: 12 markets

We're deliberately not mirroring Kalshi (every race) or Polymarket (~1,200 midterm markets).
Most races have an obvious favorite, and with our 10,000-token seed pools plus a return-%
leaderboard, buying that favorite is close to free return. So we launch only the races where
the outcome is genuinely uncertain. Payloads for `add-market` are in
[`data/midterms-2026-markets.json`](data/midterms-2026-markets.json).

All 12 are **binary Yes/No**: `place_trade` rejects any market without exactly 2 outcomes, so
the balance-of-power and seat-range ideas became Yes/No questions. Every market gets
`close_date 2026-11-03`, so `auto-close-markets` (07:00 UTC) closes trading before polls open.
Each resolves on the AP call, falling back to state certification. Resolution is **manual** via
`resolve-market`, since no election adapter exists in the watcher.

| # | Market | Why |
|---|---|---|
| 1 | Democrats win the Senate (51+)? | headline |
| 2 | Democrats win the House (218+)? | headline |
| 3 | Democrats win both chambers? | balance-of-power, as a binary |
| 4 | Democrats win 230+ House seats? | seat-count, as a binary at Cook's midpoint |
| 5 | Ossoff wins GA Senate? | toss-up; Dec 1 runoff possible |
| 6 | Collins wins ME Senate? | toss-up; RCV |
| 7 | Cooper wins NC Senate? | open seat |
| 8 | Brown wins OH Senate special? | high-profile comeback |
| 9 | Talarico wins TX Senate? | marquee; Paxton the R nominee |
| 10 | Turek wins IA Senate? | Kalshi's only Senate toss-up |
| 11 | Hobbs wins AZ governor? | toss-up incumbent |
| 12 | Bottoms wins GA governor? | open seat; runoff possible |

Add more (MI/AK/NE/NH Senate, MI/WI governor) only if players actually trade these.

---

## Reference: every 2026 race (not launching)

Scope: **35 Senate** (33 regular Class 2 + 2 specials) · **36 governors** (+ DC and 3 territories)
· **435 House seats** (79 rated competitive by Cook; the other 356 are Solid and not listed) ·
2 chamber-control markets.

Current balance: Senate 53 R – 47 D (incl. 2 independents caucusing D). House 218 R – 214 D – 1 I,
2 vacant (FL-20, TX-23).

## Timing and resolution gotchas

- **Georgia**: general-election runoff (Dec 1) if no one gets 50%. Senate (Ossoff v. Collins) and
  governor markets must say whether they resolve on Nov 3 or after the runoff.
- **Alaska** and **Maine**: ranked-choice. Final tabulation runs ~2 weeks after election day.
- **California / Washington**: top-two systems; mail ballots make close House calls take weeks.
- **Resolution source**: AP race call, falling back to state certification. Recount = wait.
- Suggest closing trading at **2026-11-03 00:00 local** (before polls open), resolving on the AP call.

## Chamber control (2 markets)

| Market | Notes |
|---|---|
| Which party controls the Senate after the 2026 election? | D needs a net +4 (VP Vance breaks 50-50 ties for R) |
| Which party controls the House after the 2026 election? | 218 seats needed; Cook projects D 224–234 |

## Senate (35 races)

Bold = incumbent running. ★ = the races Cook/forecasters treat as competitive.

| State | Seat | Incumbent | Status | Democrat | Republican | Notable other |
|---|---|---|---|---|---|---|
| Alabama | Class 2 | Tommy Tuberville (R) | Open (running for gov) | Everett Wess | Barry Moore | |
| Alaska ★ | Class 2 | Dan S. Sullivan (R) | Running | Mary Peltola | **Dan S. Sullivan** | RCV; also Gerald Heikes (R), Dan J. Sullivan (R) |
| Arkansas | Class 2 | Tom Cotton (R) | Running | Hallie Shoffner | **Tom Cotton** | |
| Colorado | Class 2 | John Hickenlooper (D) | Running | **John Hickenlooper** | Mark Baisley | |
| Delaware | Class 2 | Chris Coons (D) | Running | **Chris Coons** | Michael Katz | |
| Florida (special) | Class 3 | Ashley Moody (R, appt.) | Running | Angie Nixon | **Ashley Moody** | |
| Georgia ★ | Class 2 | Jon Ossoff (D) | Running | **Jon Ossoff** | Mike Collins | Dec 1 runoff possible |
| Idaho | Class 2 | Jim Risch (R) | Running | (D nominee withdrew) | **Jim Risch** | Todd Achilles (I, D-backed) |
| Illinois | Class 2 | Dick Durbin (D) | Open | Juliana Stratton | Don Tracy | |
| Iowa ★ | Class 2 | Joni Ernst (R) | Open | Josh Turek | Ashley Hinson | |
| Kansas | Class 2 | Roger Marshall (R) | Running | Adam Hamilton | **Roger Marshall** | |
| Kentucky | Class 2 | Mitch McConnell (R) | Open | Charles Booker | Andy Barr | |
| Louisiana | Class 2 | Bill Cassidy (R) | Open (lost primary) | Jamie Davis | Julia Letlow | |
| Maine ★ | Class 2 | Susan Collins (R) | Running | Troy Jackson | **Susan Collins** | RCV |
| Massachusetts | Class 2 | Ed Markey (D) | Running | **Ed Markey** | John Deaton | Shiva Ayyadurai (I) |
| Michigan ★ | Class 2 | Gary Peters (D) | Open | Abdul El-Sayed | Mike Rogers | |
| Minnesota ★ | Class 2 | Tina Smith (DFL) | Open | Peggy Flanagan | Michele Tafoya | |
| Mississippi | Class 2 | Cindy Hyde-Smith (R) | Running | Scott Colom | **Cindy Hyde-Smith** | Ty Pinkins (I) |
| Montana | Class 2 | Steve Daines (R) | Open | Alani Bankhead | Kurt Alme | Seth Bodnar (I) |
| Nebraska ★ | Class 2 | Pete Ricketts (R) | Running | (D nominee withdrew) | **Pete Ricketts** | Dan Osborn (I) |
| New Hampshire ★ | Class 2 | Jeanne Shaheen (D) | Open | Chris Pappas | John E. Sununu | |
| New Jersey | Class 2 | Cory Booker (D) | Running | **Cory Booker** | Justin Murphy | |
| New Mexico | Class 2 | Ben Ray Luján (D) | Running | **Ben Ray Luján** | Larry Marker | |
| North Carolina ★ | Class 2 | Thom Tillis (R) | Open | Roy Cooper | Michael Whatley | |
| Ohio (special) ★ | Class 3 | Jon Husted (R, appt.) | Running | Sherrod Brown | **Jon Husted** | |
| Oklahoma | Class 2 | Alan Armstrong (R, appt. Mar 2026, Mullin → DHS) | Open (appointee barred) | N'Kiyla Jasmine Thomas | Kevin Hern | |
| Oregon | Class 2 | Jeff Merkley (D) | Running | **Jeff Merkley** | David Brock Smith | |
| Rhode Island | Class 2 | Jack Reed (D) | Running | **Jack Reed** | Raymond McKay | |
| South Carolina | Class 2 | Darline Graham (R, appt. Jul 2026 after Lindsey Graham's death) | Running | Annie Andrews | **Darline Graham** | |
| South Dakota | Class 2 | Mike Rounds (R) | Running | (D nominee withdrew) | **Mike Rounds** | Brian Bengs (I) |
| Tennessee | Class 2 | Bill Hagerty (R) | Running | Marquita Bradshaw | **Bill Hagerty** | |
| Texas ★ | Class 2 | John Cornyn (R) | Open (lost runoff) | James Talarico | Ken Paxton | |
| Virginia | Class 2 | Mark Warner (D) | Running | **Mark Warner** | Bert Mizusawa | |
| West Virginia | Class 2 | Shelley Moore Capito (R) | Running | Rachel Fetty Anderson | **Shelley Moore Capito** | |
| Wyoming | Class 2 | Cynthia Lummis (R) | Open | James W. Byrd | Harriet Hageman | |

In Idaho, Nebraska and South Dakota the real contest is R vs. independent, so the market outcomes
should be candidate names, not parties.

## Governors (36 states + DC + 3 territories)

| State | Incumbent | Status | Democrat | Republican | Notable other |
|---|---|---|---|---|---|
| Alabama | Kay Ivey (R) | Term-limited | Doug Jones | Tommy Tuberville | |
| Alaska | Mike Dunleavy (R) | Term-limited | Jonathan Kreiss-Tomkins | Treg Taylor / Bernadette Wilson / Dave Bronson (top-4, RCV) | Taylor's certification was disputed in Sept.; check the ballot |
| Arizona | Katie Hobbs (D) | Running | **Katie Hobbs** | Andy Biggs | |
| Arkansas | Sarah Huckabee Sanders (R) | Running | Fredrick Love | **Sarah Huckabee Sanders** | |
| California | Gavin Newsom (D) | Term-limited | Xavier Becerra | Steve Hilton | top-two |
| Colorado | Jared Polis (D) | Term-limited | Phil Weiser | Victor Marx | |
| Connecticut | Ned Lamont (D) | Running | **Ned Lamont** | Ryan Fazio | |
| Florida | Ron DeSantis (R) | Term-limited | David Jolly | Byron Donalds | |
| Georgia | Brian Kemp (R) | Term-limited | Keisha Lance Bottoms | Rick Jackson | Dec 1 runoff possible |
| Hawaii | Josh Green (D) | Running | **Josh Green** | Gary Cordery | |
| Idaho | Brad Little (R) | Running | Terri Pickens | **Brad Little** | |
| Illinois | JB Pritzker (D) | Running | **JB Pritzker** | Darren Bailey | |
| Iowa | Kim Reynolds (R) | Open | Rob Sand | Zach Lahn | |
| Kansas | Laura Kelly (D) | Term-limited | Cindy Holscher | Ty Masterson | |
| Maine | Janet Mills (D) | Term-limited | Hannah Pingree | Bobby Charles | Rick Bennett (I) |
| Maryland | Wes Moore (D) | Running | **Wes Moore** | Dan Cox | |
| Massachusetts | Maura Healey (D) | Running | **Maura Healey** | Mike Minogue | |
| Michigan | Gretchen Whitmer (D) | Term-limited | Jocelyn Benson | John James | |
| Minnesota | Tim Walz (DFL) | Open | Amy Klobuchar | Lisa Demuth | |
| Nebraska | Jim Pillen (R) | Running | Lynne Walz | **Jim Pillen** | |
| Nevada | Joe Lombardo (R) | Running | Aaron Ford | **Joe Lombardo** | |
| New Hampshire | Kelly Ayotte (R) | Running | Cinde Warmington | **Kelly Ayotte** | |
| New Mexico | Michelle Lujan Grisham (D) | Term-limited | Deb Haaland | Gregg Hull | |
| New York | Kathy Hochul (D) | Running | **Kathy Hochul** | Bruce Blakeman | |
| Ohio | Mike DeWine (R) | Term-limited | Amy Acton | Vivek Ramaswamy | |
| Oklahoma | Kevin Stitt (R) | Term-limited | Cyndi Munson | Mike Mazzei | |
| Oregon | Tina Kotek (D) | Running | **Tina Kotek** | Christine Drazan | |
| Pennsylvania | Josh Shapiro (D) | Running | **Josh Shapiro** | Stacy Garrity | |
| Rhode Island | Dan McKee (D) | Lost primary | Helena Foulkes | Aaron Guckian | Ken Block (I) |
| South Carolina | Henry McMaster (R) | Term-limited | Jermaine Johnson | Alan Wilson | |
| South Dakota | Larry Rhoden (R) | Running | Dan Ahlers | **Larry Rhoden** | |
| Tennessee | Bill Lee (R) | Term-limited | Jerri Green | Marsha Blackburn | |
| Texas | Greg Abbott (R) | Running | Gina Hinojosa | **Greg Abbott** | |
| Vermont | Phil Scott (R) | Running | Amanda Janoo | **Phil Scott** | |
| Wisconsin | Tony Evers (D) | Open | David Crowley | Tom Tiffany | |
| Wyoming | Mark Gordon (R) | Term-limited | Kenneth Casner | Eric Barlow | |
| *DC (mayor)* | Muriel Bowser (D) | Open | Janeese Lewis George | — | |
| *Guam* | Lou Leon Guerrero (D) | Term-limited | Therese Terlaje | Vicente Ada | |
| *N. Mariana Is.* | David Apatang (I) | Open | — | Ralph Torres | Blas Attao (I), Lawrence Camacho (I) |
| *US Virgin Is.* | Albert Bryan Jr. (D) | Term-limited | Stacey Plaskett | — | several independents |

## House: 79 competitive districts (Cook, 2026-10-16)

Mid-decade redistricting means new maps in AL, CA, FL, LA, NC, OH, TX (and UT by court order).
"New seat" = created by redistricting. Nominees are not listed here; pull them per district when minting.

**Toss-up (21):** AZ-6 Ciscomani (R) · CA-22 Valadao (R) · CO-8 Evans (R) · FL-14 Castor (D) ·
FL-22 new seat · IA-2 open (Hinson, R) · MI-4 Huizenga (R) · MI-7 Barrett (R) · MI-10 open (James, R) ·
MT-1 open (Zinke, R) · NY-17 Lawler (R) · NC-1 Davis (D) · NC-11 open (Edwards, R, withdrew) ·
OH-7 Miller (R) · OH-9 Kaptur (D) · PA-8 Bresnahan (R) · TX-15 De La Cruz (R) · TX-34 Gonzalez (D) ·
VA-1 Wittman (R) · VA-2 Kiggans (R) · WI-3 Van Orden (R)

**Lean D (12):** AZ-1 open (Schweikert, R) · CA-13 Gray (D) · CA-48 open (Issa, R) · FL-25 Moskowitz (D) ·
IA-1 Miller-Meeks (R) · IA-3 Nunn (R) · NJ-7 Kean (R) · NM-2 Vasquez (D) · PA-7 Mackenzie (R) ·
PA-10 Perry (R) · TX-28 Cuellar (D) · WA-3 Gluesenkamp Perez (D)

**Lean R (13):** CO-5 Crank (R) · FL-13 Luna (R) · FL-27 Salazar (R) · KY-6 open (Barr, R) ·
ME-2 open (Golden, D) · MN-1 Finstad (R) · NY-21 open (Stefanik, R) · OH-10 Turner (R) · OH-15 Carey (R) ·
PA-1 Fitzpatrick (R) · SC-1 open (Mace, R) · TX-35 new seat · WI-1 Steil (R)

**Likely D (17):** CA-21 Costa · CA-45 Tran · IN-1 Mrvan · MI-8 McDonald Rivet · MN-2 open (Craig) ·
NE-2 open (Bacon, R) · NV-1 Titus · NV-3 Lee · NV-4 Horsford · NH-1 open (Pappas) · NJ-9 Pou ·
NY-3 Suozzi · NY-4 Gillen · NY-19 Riley · OH-1 Landsman · OH-13 Sykes · VA-7 Vindman

**Likely R (16):** AL-2 Figures (D) · AK-AL Begich · AZ-2 Crane · AR-2 Hill · CO-3 Hurd ·
FL-7 open (Mills, lost primary) · FL-9 Soto (D) · FL-16 open (Buchanan) · IN-5 Spartz · KS-2 Schmidt ·
MO-2 Wagner · NE-1 Flood · NV-2 open (Amodei) · TX-9 new seat · TX-23 vacant (Gonzales resigned) ·
VA-5 McGuire
