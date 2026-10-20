# AgriFair — API contract

Dalawang client ang kumakain sa iisang API: ang **web** (React, para sa seller,
admin at superadmin) at ang **mobile** (Flutter, para sa buyer). Ito ang
sanggunian nilang dalawa, para hindi na kailangang magtanong sa isa't isa.

Base URL: `/api` — halimbawa `http://localhost:8080/api`.
Kinopya ang mga halimbawa mula sa tumatakbong server, hindi hula.

---

## Balot ng sagot

Karamihan ng route ay nakabalot:

```json
{ "success": true, "message": "Products retrieved successfully", "data": { } }
```

Pero **hindi lahat** — ang `/user/me` ay ibinabalik ang dokumento mismo, walang
balot. Kaya sa mobile, tinatanggal ng `ApiClient` ang `data` kapag naroon at
ibinabalik ang buong body kapag wala.

Ang pagkabigo ay laging may mababasang `message`:

```json
{ "success": false, "message": "That name is already taken. Please choose another one." }
```

May ilang pagkabigo na may dagdag na `code` — para sa mga dapat aksyunan ng
client, hindi lang ipakita:

| `code` | Kahulugan | Dapat gawin ng client |
|---|---|---|
| `EMAIL_NOT_VERIFIED` | Hindi pa napapatunayan ang email | Dalhin sa OTP screen, magpadala ng bagong code |
| `WRONG_APP` | Ang role ay hindi para sa app na ito (hal. seller sa mobile) | Sabihin kung saang app dapat mag-sign in |
| `ACCOUNT_DEACTIVATED` | Isinara ng Super Admin ang account | Ibalik sa sign-in, ipakita ang mensahe |
| `SELLER_NOT_APPROVED` | Hindi pa aprubado ang seller | Ipakita lang ang application/Account |

> Basahin ang `code`, huwag ang pangungusap. Nagbabago ang wording; ang `code` hindi.

---

## `GET /api/products/:id`

```json
{
  "success": true,
  "message": "Product retrieved successfully",
  "data": {
    "_id": "6a89913e09aeca84016e7172",
    "name": "Premium Jasmine Rice",
    "variety": "Jasmine",
    "price": 60,
    "description": "...",
    "stock": 10,
    "lowStockThreshold": 0,
    "soldCount": 0,
    "weightTiers": [
      { "weightKg": 50, "discountPercent": 5 },
      { "weightKg": 25, "discountPercent": 2 }
    ],
    "images": ["/uploads/media/1787390813413-rice.jpg"],
    "status": "active",
    "createdBy": 6,
    "averageRating": 0,
    "reviewCount": 0,
    "createdAt": "2026-08-22T12:08:30.507Z",
    "updatedAt": "2026-08-22T12:08:30.510Z"
  }
}
```

### Bawat field

| Field | Uri | Tandaan |
|---|---|---|
| `_id` | string | Ang ObjectId. **Ito ang id sa lahat ng ibang tawag** — cart, review, order. Hindi `id`. |
| `name` | string | |
| `variety` | enum | Isa sa: `Jasmine`, `Sinandomeng`, `Brown Rice`, `Black Rice`, `Red Rice`, `Glutinous (Malagkit)`, `Other`. **Ito ang pangalan, hindi `category`** — tinatanggap pa rin ang `category` bilang query alias, pero `variety` ang laman ng sagot. |
| `price` | number | Piso kada kilo, ang batayan ng lahat ng tier. |
| `stock` | number | Bumababa kapag na-confirm ang order, hindi sa checkout. |
| `soldCount` | number | Sumusunod sa `stockDeducted`: tumataas kapag confirmed, bumabalik kapag cancelled. |
| `weightTiers` | array | `weightKg` + `discountPercent`. **Galing sa backend ang presyo ng bawat timbang — huwag nang i-compute sa app.** |
| `images` | string[] | **Server-relative** (`/uploads/...`). Kailangan ng origin sa harap — `ApiConfig.mediaUrl()` sa mobile. |
| `status` | enum | `active` o `inactive`. |
| `createdBy` | number | `userId` ng seller (hindi ObjectId). |
| `averageRating` | number | Isang desimal, galing sa Review collection. `0` kapag walang review. |
| `reviewCount` | number | |

### Presyo ayon sa timbang

```
kabuuan = price × weightKg × (1 − discountPercent / 100)
```

Nasa backend ang mga tier, kaya iisa ang sagot ng web at mobile. Dating
hardcoded sa app ang mga diskuwento — huwag nang ibalik iyon.

### Wala rito

Ipinapakita ng mobile UI ang mga badge tulad ng "Best Seller" at ang kulay ng
tag. **Wala ang mga iyon sa backend** at pandekorasyon lang sa app. Gamitin ang
`soldCount` kung kailangan ng tunay na numero.

---

## `GET /api/products`

Kaparehong hugis ng produkto, nakabalot sa listahan:

```json
{
  "success": true,
  "data": [ { } ],
  "pagination": { "total": 1, "page": 1, "limit": 10, "pages": 1 }
}
```

Query: `?page=`, `?limit=`, `?variety=` (o `?category=`), `?status=`, `?search=`.

---

## Auth

| Route | Katawan | Ibinabalik |
|---|---|---|
| `POST /auth/register` | `name`, `email`, `password`, `role` | `user` + `verificationMethod` |
| `POST /auth/login` | `email`, `password` | `token`, `user` |
| `POST /auth/verify-email` | `token` (mula sa link sa email) | `message` |
| `POST /auth/verify-email-otp` | `email`, `code` | `message` |
| `POST /auth/resend-verification` | `email` | `message` |
| `POST /auth/forgot-password` | `email` | `message` |
| `POST /auth/verify-reset-otp` | `email`, `code` | `resetToken` |
| `POST /auth/reset-password` | `resetToken`, `newPassword` | `message` |
| `PUT /user/reset-password` | `currentPassword`, `newPassword` | `message` (kailangan ng auth) |

### Token

Ang backend ay nag-iisyu ng **sariling JWT** (`token`). Itago ito at ipadala
bilang `Authorization: Bearer`; iyon ang tinitingnan ng lahat ng route. Walang
Firebase: ang password ay bcrypt hash sa Mongo.

### Sino ang nagbibigay ng code, sino ang link

Nakabatay sa `x-client` header, at **link ang default**:

| Client | `verificationMethod` |
|---|---|
| `x-client: mobile` | `otp` — 6 na digit sa email, dala ng nodemailer |
| lahat ng iba (web) | `link`: JWT link papunta sa `/login?verify=…`, na ipinapasa ng web sa `POST /auth/verify-email` |

Ipinapadala ito ng `ApiClient` ng mobile. Hindi kailangang gumawa ng anuman ang
web — tama na ang default nito.

### Role sa pag-register

Ang `allowedSelfRoles` ay `buyer` at `seller`, at **`seller` ang babagsakan
kapag walang ipinasa**. Tinatanggihan ang `superadmin` at `rider`. Ang seller ay nagiging `pending` at
naghihintay ng approval ng Super Admin bago makapasok.

> Kaya **kailangang magpadala ng `role: 'buyer'` ang mobile.** Kung hindi,
> bawat signup sa cellphone ay magiging naka-lock na seller account.

### Bago makapasok

- Kailangang **verified na ang email** — lahat ng role, kasama ang buyer.
- Ang `seller` ay kailangang **`active`**, hindi `pending`.
- Ang `suspended` ay tinatanggihan.
- Ang `rejected` (seller na hindi inaprubahan) ay tinatanggihan, kasama ang dahilan.

---

## Natatangi ang pangalan at email

Pareho itong sinusuri sa pag-register at sa `PUT /user/edit` (pangalan lang;
hindi na mababago ang email mula sa profile, dahil ito ang na-verify na address). Ang pangalan ay
hindi apektado ng laki ng letra at ng dami ng espasyo — iisa ang
`"Reyca De Alba"`, `"reyca de alba"`, at `"reyca  de  alba"`.

Isinasagot ang `409` kapag may kaagaw.

---

## Rate limit

| Uri | Bilang | Saklaw |
|---|---|---|
| Paghingi ng code | 5 / 15 min | `/auth/forgot-password`, `/auth/resend-verification` |
| Pagsagot ng code | 20 / 15 min | `/auth/verify-*`, `/auth/reset-password` |
| Palit ng password | 5 / 15 min | `/user/reset-password` |

Hiwalay ang paghingi at pagsagot. Noong iisa ang budget nila, ang isang normal
na flow — humingi, mali ang type, i-type ulit, tapusin — ay naubusan sa
kalagitnaan, at hindi na maabot ang attempt counter ng code.

Ang `429` ay JSON, kaya nababasa ng client ang dahilan:

```json
{ "success": false, "message": "Too many codes requested. Wait a few minutes and try again." }
```

---

## Iba pang buyer route

| Route | Layunin |
|---|---|
| `GET /cart`, `POST /cart/items`, `PUT /cart/items/:productId`, `DELETE /cart/items/:productId` | Cart |
| `POST /cart/checkout` | Gumagawa ng order (buyer lang) |
| `GET /buyer/orders`, `GET /buyer/orders/:groupId`, `POST /buyer/orders/:groupId/cancel` | Order ng buyer |
| `POST /buyer/orders/:groupId/received` | Kinukumpirma ng buyer na natanggap; nagiging `completed` ang mga `delivered` |
| `GET /reviews/product/:productId`, `POST /reviews` | Review |
| `GET /notifications`, `PUT /notifications/:id/read`, `PUT /notifications/read-all` | Abiso |
| `GET /chat/conversations`, `GET /chat/messages/:conversationId`, `POST /chat/send` | Chat |
| `GET /user/me`, `PUT /user/edit` | Profile |

---

## Cart at checkout

Ang `GET /cart` (at bawat sagot ng cart route) ay may:

```json
{ "items": [], "subtotal": 2500, "deliveryFee": 50,
  "deliveryFees": [{ "sellerId": 2, "fee": 50 }], "total": 2550 }
```

**Ang server ang nagkukuwenta ng `deliveryFee`**: isa bawat seller sa cart, mula
sa `deliveryFee` ng seller (₱80 kung wala). Huwag nang magpadala ng fee sa
checkout; hindi na ito binabasa.

`POST /cart/checkout` (multipart):

| Field | Kailan |
|---|---|
| `customerName`, `deliveryAddress` | Palagi |
| `addressId` | Palagi. Isa sa mga naka-save na address ng buyer |
| `customerContact` | PH mobile (`09…`, `+639…`). Kapag wala, kinukuha sa address |
| `paymentMethod` | `Cash/COD` o `GCash` lang |
| `paymentProof` (file) at `paymentReference` | Kapag GCash. Digits lang ang reference, at hindi puwedeng nagamit na sa ibang order |

Isang tindahan lang bawat bayad sa GCash: tinatanggihan ang GCash checkout na
may laman mula sa dalawang seller.

## Seller: order

| Route | Layunin |
|---|---|
| `PUT /admin/orders/:id/status` | `status`, `reason`. Sumusunod sa mga patakaran sa ibaba |
| `PUT /admin/orders/:id/payment` | `paid`, `reference`, `amount`, `note`. Para sa lahat ng linya ng parehong checkout ng seller; naitatala sa `paymentHistory` |
| `PUT /admin/orders/:id/courier` | `courierName`, `courierReference`, `courierContact`: courier na hindi sariling rider |
| `POST /admin/orders/:id/delivered` | `proof` (litrato), `note`: seller ang nag-upload ng litrato sa pinto |

Mga patakaran ng status (para sa order mula sa app):

- `confirmed`: kapag GCash, kailangang `paid` na.
- `shipped`: kailangang may rider, o courier na may tracking number.
- `delivered`: kailangang may litrato sa pinto.
- `completed`: ang buyer ang nagkukumpirma; puwedeng isara ng seller pagkalipas
  ng 3 araw mula sa delivery.

## Super Admin

| Route | Layunin |
|---|---|
| `PUT /superadmin/approvals/:id/reject` | `reason`. Nagiging `rejected` ang seller; makikita niya ang dahilan sa sign-in |
| `PUT /superadmin/users/:id` | `name`, `email`, `role`, `status`, `password` lang ang binabasa. Hina-hash ang password |

---

## Order, bayad at paghahatid (2026-10)

Buong paliwanag: `WORKFLOW.md`. Lahat ng aksyon sa ibaba ay para sa buong
seller-order (lahat ng linya ng iisang seller sa iisang checkout), kahit isang
linya lang ang `:id` na ipinadala.

### Buyer (`/api/buyer`, buyer lang)

| Method | Path | Body | Gawa |
|---|---|---|---|
| POST | `/orders/:groupId/cancel` | `{ reason }` | Kanselado agad (pending at unpaid) o request sa seller. Sagot: order + `cancellationOutcome` (`cancelled`/`requested`) |
| POST | `/orders/:groupId/payment-proof` | multipart `paymentProof`, `paymentReference` | Bagong GCash resibo matapos `rejected` |
| POST | `/orders/:groupId/problem` | `{ reason }` | Report a problem sa delivered na order |
| POST | `/orders/:groupId/received` | | Tapos na (kung bayad at walang bukas na problema/request) |

Mga bagong field sa order ng buyer: `cancelNeedsApproval`, `cancellationRequested`,
`problemOpen`, `canResubmitPayment`, `canReportProblem`, `paymentNote`,
`cancellationNote`, `complaintNote`, `refund { amount, reference }`, at sa bawat
item `paymentStatus`, `riderUserId`, `courierName`.

`POST /api/cart/checkout` tumatanggap ng `checkoutKey` (o header `Idempotency-Key`):
parehong key, parehong order — hindi nadodoble.

### Seller (`/api/admin`, aprubadong seller lang)

| Method | Path | Body |
|---|---|---|
| PUT | `/orders/:id/status` | `{ status, reason }` |
| PUT | `/orders/:id/payment` | `{ paid, reference, amount, note }` — GCash na `proof_sent` lang |
| PUT | `/orders/:id/cancellation` | `{ approve, note }` |
| PUT | `/orders/:id/refund` | `{ amount?, reference, note }` |
| PUT | `/orders/:id/cod` | `{ amount, note }` — pagtama ng cash, may dahilan |
| PUT | `/orders/:id/problem` | `{ note }` |
| POST | `/orders/:id/delivered` | multipart `proof`, `note`, `cashCollected` (courier) |

### Rider (`/api/riders/me`, rider lang)

| Method | Path | Body |
|---|---|---|
| GET | `/deliveries?scope=active\|history` | |
| GET | `/deliveries/:orderId` | |
| POST | `/deliveries/:orderId/accept` | |
| POST | `/deliveries/:orderId/decline` | `{ reason }` |
| POST | `/deliveries/:orderId/start` | |
| POST | `/deliveries/:orderId/proof` | multipart `proof`, `note` (hindi pa delivered) |
| POST | `/deliveries/:orderId/delivered` | `{ cashCollected?, note? }` — ligtas ulitin |
| PUT | `/deliveries/:orderId/location` | `{ lat, lng }` |

### Iba pa

- `POST /api/user/seller-application` — ipadala ang application ng seller.
- `POST /api/chat/send` tumatanggap ng `orderRef` (groupId) para sa rider ↔ buyer.
- `POST /api/jobs/auto-complete` — header `x-cron-secret`; wala kapag walang `CRON_SECRET`.
- `DELETE /api/superadmin/users/:id` — nagde-deactivate na, hindi nagbubura.
