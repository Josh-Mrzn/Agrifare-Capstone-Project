# AgriFair — System Architecture

Paano nagkakadikit-dikit ang mga piraso: tatlong kliyente, isang backend, isang
database, at dalawang panlabas na serbisyo. Ang dokumentong ito ay tungkol sa
**kung ano ang totoong nakasulat sa code**, hindi sa balak — kaya may seksyon sa
dulo para sa mga bagay na nakabitin pa.

- **Repo:** `Captone-Project`
- **Huling na-update:** Okt 6, 2026

---

## 1. Ang buong larawan

```mermaid
graph TB
    subgraph clients["Mga kliyente"]
        MOB["<b>Mobile — Flutter</b><br/>buyer<br/><i>mobile/</i>"]
        WEB["<b>Web — React + Vite</b><br/>seller · admin · superadmin<br/><i>frontend/</i>"]
    end

    subgraph server["Backend — Node + Express"]
        API["<b>REST API</b><br/>:8080/api"]
    end

    subgraph data["Data"]
        MONGO[("MongoDB<br/><i>mongoose</i>")]
        FILES[("Files sa disk<br/>uploads/ · PRIVATE_DIR")]
        PSGC_J[("PSGC JSON<br/><i>src/data/</i>")]
    end

    subgraph ext["Panlabas"]
        SMTP["Email<br/><i>Brevo o SMTP: OTP, verify link, report</i>"]
        PSGC["psgc.gitlab.io<br/><i>build time lang</i>"]
    end

    MOB -->|"HTTPS + Bearer JWT<br/>x-client: mobile"| API
    WEB -->|"HTTPS + Bearer JWT"| API

    API --> MONGO
    API --> FILES
    API --> PSGC_J
    API -->|OTP, link, PDF| SMTP
    PSGC -.->|"npm run build:psgc"| PSGC_J
```

Isang mahalagang detalye: **ang PSGC ay hindi tinatawagan habang tumatakbo ang
system.** Isang beses lang itong kinukuha sa build, isinusulat sa tatlong JSON
file, at binabasa sa memorya pagbukas ng server. Kaya gumagana ang address form
kahit walang internet ang laptop.

---

## 2. Daloy ng isang request

Iisa ang hugis ng lahat ng request. Nakalayer ito nang sadya — ang bawat antas
ay may isang trabaho, at ang database ay hindi kailanman nakikita ng controller.

```mermaid
graph LR
    C["Kliyente"] --> R["<b>routes/</b><br/>path + middleware"]
    R --> MW["<b>middleware/</b><br/>protect · authorizeRoles<br/>rateLimiter · multer"]
    MW --> CTL["<b>controllers/</b><br/>basahin ang req<br/>isulat ang res"]
    CTL --> SVC["<b>services/</b><br/><i>ang patakaran</i>"]
    SVC --> REPO["<b>repositories/</b><br/>mga query"]
    REPO --> M[("<b>models/</b><br/>schema")]
    SVC --> ERR["errorMiddleware<br/><i>isang labasan ng error</i>"]
```

| Layer | Trabaho | Halimbawa |
|---|---|---|
| `routes/` | Anong path, sinong pinapayagan | `cartRoutes.js` |
| `middleware/` | Auth, rate limit, upload | `authMiddleware.js` |
| `controllers/` | `req` papasok, `res` palabas | `chatController.js` |
| `services/` | **Ang mga patakaran** | `cartService.js` |
| `repositories/` | Mga query lang | `cartRepository.js` |
| `models/` | Hugis ng data | `Cart.js` |

Nasa `services/` ang mga desisyon — kung sino ang pwedeng bumili, magkano, at
kung kailan mababawasan ang stock. Kaya kapag may tanong kung *bakit* ganito ang
kilos ng system, doon ang sagot, hindi sa controller.

---

## 3. Pagkakakilanlan — dalawang numero, isang tao

Ito ang pinakamadulas na bahagi ng system, at pinagmulan ng ilang totoong bug.

Ang bawat user ay may **dalawang** pagkakakilanlan:

| | Ano | Saan ginagamit |
|---|---|---|
| `_id` | Mongo ObjectId | Mga ugnayan sa loob ng database — `Conversation.participants`, `Message.sender` |
| `userId` | Numero (1, 2, 3…) | Lahat ng nakikita ng kliyente — JWT, `/chat/send`, `Order.sellerId` |

**Ang alituntunin: ang app ay laging `userId`, ang database ay laging `_id`.**
Kapag naghalo ang dalawa, walang error na lalabas — tahimik lang na hindi
magtutugma ang lahat. Ganito nangyari na ang lahat ng mensahe ay nagmukhang
galing sa kabila: `_id` ang binabasa ng app habang `userId` ang alam nito sa
sarili.

```mermaid
sequenceDiagram
    participant M as Mobile
    participant A as API
    participant DB as MongoDB

    M->>A: POST /auth/login (x-client: mobile)
    A->>DB: hanapin ang user, ihambing ang bcrypt hash
    alt hindi pa verified
        A-->>M: 403 + code na maaaksyunan
        M->>A: POST /auth/verify-otp
    else verified
        A-->>M: JWT (may userId) + user
    end
    M->>A: susunod na request + Bearer JWT
```

Ang password ay bcrypt hash sa Mongo, at iyon lang ang sinusuri. Inalis na ang
Firebase Auth (Okt 2026); ang `scripts/syncFromFirebase.js` ang isang beses na
paglipat ng `emailVerified`.

Ang paraan ng verification ay nakadepende sa kliyente:

| Kliyente | Header | Paraan |
|---|---|---|
| Mobile | `x-client: mobile` | 6-digit OTP sa email (nodemailer) |
| Web | wala | JWT verification link sa email, binubuksan sa `/login?verify=…` |

---

## 4. Mula sa pagtingin hanggang sa pagbili

```mermaid
sequenceDiagram
    actor B as Buyer
    participant M as Mobile
    participant A as API
    participant DB as MongoDB
    participant S as Seller (web)

    B->>M: buksan ang produkto
    M->>A: GET /products/:id
    Note over M: pipiliin ang timbang sa sheet,<br/>ang di-available ay di mapipindot

    B->>M: Add to Cart
    M->>A: POST /cart/items {productId, weightKg, quantity}
    A->>DB: i-save ang cart (nasa server, hindi sa telepono)

    B->>M: Checkout
    M->>A: POST /cart/checkout (multipart, may resibo)
    A->>DB: Order bawat linya, iisang orderNumber
    A->>DB: system message sa thread ng bawat seller
    A->>DB: linisin ang cart

    S->>A: PATCH status → confirmed
    A->>DB: bawasan ang stock, itala ang galaw
    A->>DB: system message: "confirmed…"
    M->>A: GET /chat/messages/:id
    A-->>M: makikita ng buyer ang update sa usapan
```

Ilang bagay na sadya:

- **Nasa server ang cart, hindi sa telepono.** Kaya hindi ito nawawala sa
  reinstall at nakikita ng checkout. Muling pinepresyo ito laban sa buhay na
  produkto sa bawat pagbasa, kaya lumalabas agad ang tumaas na presyo o naubos
  na stock.
- **Isang `Order` row bawat linya**, pero iisa ang `orderNumber` at `groupId` —
  magkahiwalay na naghahatid at binabayaran ang mga seller, pero isang resibo
  ang nakikita ng buyer.
- **Kapag nakumpirma pa lang binabawasan ang stock**, hindi sa checkout. Ang
  order na hindi natuloy ay hindi dapat magnakaw ng stock.

---

## 5. Mga mensahe

Tatlong uri ang mensahe, at magkaiba ang kilos ng bawat isa.

```mermaid
graph TB
    subgraph kinds["Message.kind"]
        T["<b>text</b><br/>may nagta-type"]
        S["<b>system</b><br/>ang order mismo"]
        P["<b>product</b><br/>ipinasang listing"]
    end

    T -->|"unread++<br/>may notification"| INBOX["Inbox"]
    S -->|"hindi kailanman unread<br/>walang notification"| INBOX
    P -->|"unread++<br/>may card na mapipindot"| INBOX
```

Ang `system` ay hindi tanong — kaya hindi ito naglalagay ng pulang badge. Ang
order na napunta sa "shipped" ay balita, hindi hiling.

```mermaid
sequenceDiagram
    participant Buyer
    participant API
    participant Seller

    Buyer->>API: POST /chat/send {receiverUserId, productId}
    API-->>Buyer: product card (may pangalan, presyo, stock)
    Note over API: Checkout at status change ay<br/>tahimik na nagsusulat dito rin
    API->>Seller: "Order AGF-XXXX placed…"
    Seller->>API: PATCH status → shipped
    API->>Buyer: "Order AGF-XXXX is on the way…"
```

---

## 6. Ang address

Walang hinuhulaan. Tunay na PSGC data ng PSA ang pinanggagalingan.

```mermaid
graph LR
    BUILD["npm run build:psgc"] -->|isang beses| J1["provinces.json<br/>81"]
    BUILD --> J2["cities.json"]
    BUILD --> J3["barangays.json"]
    J1 & J2 & J3 -->|binabasa sa memorya<br/>pagbukas ng server| GEO["/api/geo"]
    GEO --> APP["Province → City → Barangay<br/><i>sunod-sunod na dropdown</i>"]
```

Ang address ay nasa `User.addresses[]`, hindi sa hiwalay na collection.
Sinisiguro ng `addressService.assertOneDefault()` na **laging eksaktong isa** ang
default: ang una ay awtomatikong default, at kapag binura ang default ay may
ibang hahalili.

---

## 6b. Ang paghahatid

Tatlong punto, at ipinapakita ng mapa kung alin man sa kanila ang meron.

```mermaid
graph LR
    SHOP["<b>Pickup</b><br/>User.pickupLat/Lng<br/><i>itinatakda ng seller</i>"]
    RIDER["<b>Rider</b><br/>Order.delivery<br/><i>habang naglalakbay</i>"]
    DOOR["<b>Dropoff</b><br/>addresses[].lat/lng<br/><i>pinipin ng buyer</i>"]

    SHOP -.->|"snapshot sa checkout"| ROUTE["Order.route"]
    DOOR -.->|"snapshot sa checkout"| ROUTE
    ROUTE --> API["GET /api/delivery/:orderId"]
    RIDER --> API
    API --> MOBMAP["Mobile<br/><i>flutter_map</i>"]
    API --> WEBMAP["Web<br/><i>react-leaflet</i>"]
```

Parehong OpenStreetMap tiles ang ginagamit ng dalawa, kaya **iisang mapa ang
tinitingnan ng buyer at ng seller**, at walang kailangang API key.

Tatlong bagay na sadya:

- **Naka-snapshot sa `Order.route` ang dalawang dulo sa checkout.** Ang buyer na
  nag-edit o nagbura ng address pagkatapos umorder ay hindi dapat makapagpalit
  ng destinasyon ng order na nasa daan na.
- **May fallback ang pickup.** Kapag walang naka-snapshot — order na inilagay
  bago pa nag-pin ang seller — ang kasalukuyang pickup point niya ang tumatayo.
  Kaya ang huling pag-set ay nag-aayos pati sa mga lumang order, hindi lang sa
  mga susunod.
- **Kada order row ang mapa, hindi kada order.** Ang basket na hati sa dalawang
  seller ay dalawang biyahe mula sa dalawang tindahan — ang iisang mapa ay
  kailangang pumili ng isa at magkakamali sa isa.

### Saan nanggagaling ang destinasyon

```mermaid
graph TB
    A["Address na isinulat<br/><i>province · city · barangay · street</i>"]
    A -->|"barangay + city + province lang"| G["Nominatim<br/><i>naka-cache sa GeoCache</i>"]
    A -.->|"HINDI KAILANMAN<br/>ang street line"| X["'white house po bahay namin'"]
    G --> P["<b>approximate</b><br/>gitna ng barangay"]
    B["Buyer na nakatayo sa pinto"] -->|"Mark the exact spot"| E["<b>exact</b>"]
    P & E --> R["Order.route<br/><i>naka-snapshot sa checkout</i>"]

    style X stroke-dasharray: 4 4
```

**Ang street line ay hindi kailanman ipinapadala sa geocoder** — tanging ang
tatlong structured na field mula sa PSGC dropdown. Ang "white house po bahay
namin" ay magre-resolve sa lugar na tiyak at mali, at ang rider na nagtitiwala
roon ay mas malalayo pa sa pinto kaysa kung binasa na lang niya ang mga salita.

Barangay ang tamang antas — iyon ang paraan ng paghahatid dito: mapa hanggang
barangay, landmark ang natitira. Nakasulat na "approximate" saanman ito
ipinapakita.

**Hindi rin ito nanggagaling sa kung nasaan ang tao ngayon.** Ang bumibili mula
sa eskwelahan ay hindi dapat mapadalhan sa eskwelahan — kaya ang awtomatikong
daan ay ang address mismo, at ang "Mark the exact spot" ay para lang sa taong
nakatayo talaga sa pinto niya.

---

## 6c. Ang bayad

Walang GCash hangga't walang tumitingin.

```mermaid
stateDiagram-v2
    [*] --> unset: walang isinumite
    unset --> pending: nag-submit ang seller<br/>ng account at QR
    pending --> verified: inaprubahan ng<br/>Super Admin
    pending --> rejected: tinanggihan<br/>(may dahilan)
    rejected --> pending: muling isinumite

    note right of pending
        Walang ipinapadala ang server:
        walang numero, walang QR.
        Cash on Delivery ang inaalok ng app.
    end note

    note right of verified
        Lumalabas ang numero at QR.
        Dapat mag-upload ng resibo
        ang buyer bago mag-order.
    end note
```

Ang `sellerService.getPaymentDetails` ang tanging pinto, at hindi ito
naglalabas ng anuman maliban kung `payout.status === 'verified'`. Sinasabi nito
kung **alin sa tatlo** ang dahilan — mahalaga iyon, dahil ang seller na
naghihintay ng approval ay dating sinasabihang wala siyang ginawa.

Ipinapatupad sa `cartService.checkout` ang resibo, hindi lang sa screen: ang
naka-disable na button ay kagandahang-loob sa buyer, hindi patakaran.

---

## 6d. Ang mga review

```mermaid
sequenceDiagram
    actor B as Buyer
    participant A as API
    participant DB as MongoDB

    Note over B: completed na ang order
    B->>A: POST /reviews {orderId, rating, comment, images[]}
    A->>DB: completed ba ito at kanya ba?
    A->>DB: may review na ba ito?
    alt pumasa
        A->>DB: i-save (hanggang 4 larawan)
        A-->>B: review
    else hindi
        A-->>B: tinanggihan
    end
```

**Laban sa order, hindi sa produkto.** Iyon ang buong garantiya: buyer na
siyang umorder, order na completed na, at isang beses lang. Kaya walang
"Write a review" sa listahan ng review — nagsisimula ito sa mismong order.

Nakatakip ang pangalan (`R**a`): pampublikong tala ng binili ang isang review,
at maliit lang ang mga tindahan dito.

---

## 6e. Ang mga naghahatid

Apat na role na: `superadmin`, `seller`, `buyer`, at `rider`.

```mermaid
sequenceDiagram
    actor S as Seller
    participant A as API
    actor R as Rider
    actor B as Buyer

    S->>A: POST /riders {name, email}
    A->>A: account + random password<br/>na walang nakakaalam
    A->>R: activation link sa email (48 oras)
    R->>A: POST /auth/activate/status {token}
    A-->>R: valid / expired / active / invalid
    R->>A: POST /auth/activate {token, password}
    Note over R: siya ang pumili ng password,<br/>sign in sa app pagkatapos
    opt kung expired ang link
        R->>A: POST /auth/activate/resend {token}
        A->>R: bagong link sa email na nasa account
    end

    S->>A: PUT /riders/assign/:orderId
    Note over A: dito lang nabubuksan<br/>ang order sa rider
    R->>A: GET /riders/me/deliveries
    loop tuwing 15s habang naka-share
        R->>A: PUT .../location
        A-->>B: live sa mapa
    end
    R->>A: POST .../proof (litrato sa pintuan)
    A->>A: status -> delivered
    A-->>B: makikita ang litrato
    A-->>S: makikita rin
```

Tatlong bagay na sadya:

- **Hindi alam ng seller ang password.** Random ito at itinapon — hindi dapat
  kayang mag-sign in ng seller bilang tauhan niya.
- **Ang pag-assign ang nagbubukas ng order.** Hindi sapat ang pagtatrabaho sa
  seller; ang pangalan sa order ang nagbibigay ng access, at doon lang.
- **Nasa web ang portal ng rider (`/rider`).** Listahan, link sa mapa, switch
  ng lokasyon, kamera — may browser na ang bawat telepono.

---

## 7. Mga file at privacy

Hindi lahat ng na-upload ay pampubliko.

| Uri | Saan | Sinong nakakakita |
|---|---|---|
| Larawan ng produkto, avatar, larawan sa chat at review | `uploads/media` | Kahit sino — static |
| Resibo ng GCash, QR ng seller, dokumento | `PRIVATE_DIR` | Sa pamamagitan lang ng `/api/files/:name` na may auth |

Apat na tuntunin sa `/api/files`, at bawat isa ay may dahilan:

```mermaid
graph TB
    F["/api/files/:name"] --> O{"May-ari?"}
    O -->|oo| Y["papasok"]
    O -->|hindi| Q{"Aprubadong QR<br/>ng seller?"}
    Q -->|oo| Y
    Q -->|hindi| R{"Buyer o seller ng<br/>order na may ganitong resibo?"}
    R -->|oo| Y
    R -->|hindi| S{"Super Admin?"}
    S -->|oo| Y
    S -->|hindi| N["403"]
```

Ang aprubadong QR lang ang bukas sa lahat — pambayad iyon, kailangang makita.
Ang hindi pa aprubado ay credential pa rin. Ang resibo ay para sa dalawang
taong may kinalaman doon: ang nagpadala ng pera at ang dapat tumingin kung
dumating ito.

**Hindi gumagana ang plain `<a href>` o `<img src>` dito** — walang
Authorization header ang browser navigation. Kailangang kunin bilang blob
(web) o may `imageHeaders()` (mobile).

Tatlong sadyang pagpigil sa `sellerService`:

- Ang `getPublicProfile` ay naglalabas ng badge at uri ng dokumento — hinding-hindi ang file.
- Ang `getPaymentDetails` ay walang ibinabalik hangga't hindi `payout.status === 'verified'`.
- Ang mga pangalan sa review ay nakatakip (`R**a`).

---

## 8. Kung ano ang tinatago sa buyer

Isang tuntunin, isang lugar: `STOREFRONT_FILTER` sa `models/Product.js`.

```js
{ status: 'active', stock: { $gt: 0 } }
```

Ginagamit ito ng **lahat** ng listahang pambuyer — listing, search, category,
shop ng seller, at ang shop directory. Ang mga kasangkapan ng seller ay
humihiling ng `?includeSoldOut=true`, dahil sila ang kailangang makakita ng
naubos para ma-restock.

---

## 9. Paano nakakarating ang mobile sa backend

```mermaid
graph LR
    APP["Flutter app"] -->|"1"| L["localhost:8080<br/><i>adb reverse — USB</i>"]
    APP -->|"2"| E["10.0.2.2:8080<br/><i>emulator</i>"]
    APP -->|"3"| W["lanHost:8080<br/><i>Wi-Fi</i>"]
```

Sinusubukan ng `ApiConfig` ang tatlo ayon sa pagkakasunod at inaalala kung alin
ang sumagot. Nauuna ang USB dahil **wala itong pakialam kung anong network** —
ang LAN address ay ang unang nagiging luma kapag nag-iba ng DHCP.

```
adb reverse tcp:8080 tcp:8080
```

---

## 10. Nakabitin pa

Mga bagay na totoo sa code ngayon at dapat malaman:

- **Walang real-time na koneksiyon.** Inalis ang Socket.io: walang kliyenteng
  kumokonekta, at walang pagsusuri kung sino ang nagpapadala. Binabasa ulit ng
  web at app ang chat at mga abiso kada ilang segundo. Kapag ibabalik ito,
  kailangang i-verify ang JWT sa handshake.
- **Mock pa rin ang notifications sa mobile** — lokal na model, hindi
  `/api/notifications`.
- **Nasa disk ng server ang mga upload.** Sa hosting na nabubura ang disk sa
  bawat deploy (Railway na walang volume, Render), nawawala ang mga litrato at
  resibo. Kailangan ng volume o ng object storage.
- **Hindi pa nasusubukan nang buo ang GCash** hangga't walang seller na
  `payout.status === 'verified'`.
- **Walang routing sa mapa.** Tuwid na linya ang guhit sa pagitan ng tindahan at
  ng pinto, hindi ang daan na tatahakin — at sinasabi ito ng card sa halip na
  magpanggap.
- **Manu-manong ibinabahagi ng seller ang posisyon.** Walang background
  tracking; pinipindot niya ang "Share my location" habang nasa daan.

---

## 11. Mapa ng mga folder

```
Captone-Project/
├── backend/src/
│   ├── routes/          16 route group, lahat sa ilalim ng /api
│   ├── controllers/     req → res
│   ├── services/        ang mga patakaran
│   ├── repositories/    mga query
│   ├── models/          mongoose schema
│   ├── middleware/      auth · rate limit · upload · error
│   ├── config/          mailer
│   ├── utils/           escapeRegex
│   ├── data/            PSGC JSON (galing sa build)
│   ├── scripts/         buildPsgc · seeder · migrations · syncFromFirebase
│   └── (test/)          node:test, `npm test`
├── frontend/src/
│   ├── components/      PortalShell · Modal · account forms · iba pang shared
│   ├── pages/           landing · admin (seller) · superadmin · rider
│   └── index.css        design tokens + shared components (light at dark)
└── mobile/lib/
    ├── screens/         25 screen
    ├── services/        isang file bawat API area
    ├── models/          data + ChangeNotifier state
    ├── widgets/         clay · sheets · cards
    └── theme/           claymorphism tokens
```

Isang bagay tungkol sa state sa mobile: ginagamit nito ang `ChangeNotifier` +
`InheritedNotifier` (`CartModel.of(context)`), hindi ang `provider` package.
Sadya ito — ito ang pattern na ginamit sa umpisa, at ang paglipat ay
magpapalit ng bawat screen nang walang bagong nakukuha.
