import { useSearchParams } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { openAppHref } from '../utils/appLinks';
import logoImg from '../assets/logo.png';
import './rider/ActivatePage.css';

/**
 * Where PayMongo's checkout page sends the buyer back to (success_url and
 * cancel_url). The buyer started on the phone app, so this only says what
 * happened and hands them back to it - the app asks the server, which asks
 * PayMongo, whether the order is really paid.
 */
export default function PaymentReturnPage({ outcome }) {
  const [params] = useSearchParams();
  const order = params.get('order') || '';
  const paid = outcome === 'done';

  return (
    <div className="act">
      <main className="act-body">
        <div className="act-brand">
          <img src={logoImg} alt="" width="36" height="36" />
          <span translate="no">AgriFair</span>
        </div>

        <div className="stack">
          <h1>{paid ? 'Payment sent' : 'Payment not finished'}</h1>
          <p className="act-text">
            {paid
              ? <>Thanks. Go back to the AgriFair app and open order {order ? <strong>{order}</strong> : 'your order'} to see it marked paid.</>
              : <>You left the payment page before paying. Your order {order ? <strong>{order}</strong> : ''} is saved: open it in the app and tap <strong>Pay now</strong> to try again.</>}
          </p>
          <a className="btn btn-primary btn-lg btn-block" href={openAppHref()}>
            <Smartphone size={18} aria-hidden="true" /> Back to the AgriFair app
          </a>
          <p className="field-hint">
            Payment gateway integration (PayMongo sandbox). This is a test payment: no real money was charged.
          </p>
        </div>
      </main>
    </div>
  );
}
