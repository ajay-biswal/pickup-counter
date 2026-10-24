import { useCallback, useEffect, useRef, useState } from 'react';
import { getOrderStatus, simulatePayment } from '../../lib/api';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Copy, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  OrderCreated,
  OrderStatus,
} from '../../types/api';
import { formatPaise } from '../../lib/money';
interface PaymentPanelProps {
  order: OrderCreated;
  onBackToCatalog: () => void;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function isTerminalStatus(status: OrderStatus) {
  return status === 'PAID' || status === 'EXPIRED' || status === 'NEEDS_REVIEW' || status === 'PICKED_UP';
}

function statusCopy(status: OrderStatus) {
  switch (status) {
    case 'PAID':
      return { title: 'Payment confirmed', description: 'You’re all set. Head to the pickup locker to collect your snacks.', className: 'status-card--success' };
    case 'EXPIRED':
      return { title: 'Your hold has expired', description: 'The reservation window ended before payment was confirmed. Your items are back on the shelf.', className: 'status-card--expired' };
    case 'NEEDS_REVIEW':
      return { title: 'Payment needs a quick review', description: 'We received a payment event that needs checking. Please don’t pay again; ask the counter attendant for help.', className: 'status-card--review' };
    default:
      return { title: 'Waiting for payment', description: 'Complete the simulated payment to confirm your order. This demo does not move real money.', className: '' };
  }
}

export function PaymentPanel({ order, onBackToCatalog }: PaymentPanelProps) {
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [secondsLeft, setSecondsLeft] = useState(Math.max(0, order.expiresInSeconds));
  const [pollError, setPollError] = useState('');
  const [copied, setCopied] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [confirmationPending, setConfirmationPending] = useState(false);
  const mountedRef = useRef(false);
  const statusRequestRef = useRef<Promise<Awaited<ReturnType<typeof getOrderStatus>>> | null>(null);
  const statusGenerationRef = useRef(0);
  const confirmationPendingRef = useRef(false);
  const paymentLoadingRef = useRef(false);
  const immediateStatusPendingRef = useRef(false);

  const setPending = useCallback((pending: boolean) => {
    confirmationPendingRef.current = pending;
    setConfirmationPending(pending);
  }, []);

  const readOrderStatus = useCallback(async (fresh = false) => {
    while (statusRequestRef.current) {
      const inFlight = statusRequestRef.current;
      if (!fresh) return inFlight;
      await inFlight.catch(() => undefined);
    }

    const request = getOrderStatus(order.id);
    statusRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (statusRequestRef.current === request) statusRequestRef.current = null;
    }
  }, [order.id]);

  useEffect(() => {
    // performance.now is monotonic and avoids relying on the customer's wall clock.
    const receivedAt = performance.now();
    const durationMs = Math.max(0, order.expiresInSeconds) * 1000;
    const updateCountdown = () => {
      const elapsedMs = performance.now() - receivedAt;
      setSecondsLeft(Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000)));
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [order.id, order.expiresInSeconds]);

  useEffect(() => {
    let stopped = false;
    let timeout: number | undefined;
    let failures = 0;
    mountedRef.current = true;

    const poll = async () => {
      const generation = statusGenerationRef.current;
      try {
        const result = await readOrderStatus();
        if (stopped) return;
        if (generation !== statusGenerationRef.current) {
          timeout = window.setTimeout(poll, 0);
          return;
        }
        failures = 0;
        setPollError('');
        setStatus(result.status);
        if (isTerminalStatus(result.status)) {
          setPending(false);
          setPaymentError('');
        } else if (
          result.status === 'HELD' && confirmationPendingRef.current &&
          !paymentLoadingRef.current && !immediateStatusPendingRef.current
        ) {
          setPending(false);
          setPaymentError('The payment was not confirmed. You can try again while your reservation is active.');
        }

        if (isTerminalStatus(result.status)) {
          return;
        }
      } catch (error) {
        if (stopped) return;
        failures += 1;
        setPollError(error instanceof Error ? error.message : 'Could not refresh order status.');
      }

      if (!stopped) {
        timeout = window.setTimeout(poll, Math.min(5000, 1500 * 2 ** Math.min(failures, 2)));
      }
    };

    void poll();
    return () => {
      stopped = true;
      mountedRef.current = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [order.id, readOrderStatus, setPending]);


  const startPayment = async () => {
    if (paymentLoading || confirmationPending || terminal || secondsLeft <= 0) return;

    paymentLoadingRef.current = true;
    setPaymentLoading(true);
    setPaymentError('');
    statusGenerationRef.current += 1;
    let simulationFailed = false;
    try {
      try {
        await simulatePayment(order.id);
      } catch {
        // A lost response does not prove the simulated payment failed.
        simulationFailed = true;
      }

      if (mountedRef.current) {
        setPending(true);
        setPaymentError(simulationFailed
          ? 'Confirmation is taking longer than expected. Checking your order status…'
          : 'Payment submitted. Waiting for order confirmation…');
        statusGenerationRef.current += 1;
        immediateStatusPendingRef.current = true;
        try {
          const result = await readOrderStatus(true);
          if (mountedRef.current) {
            setStatus(result.status);
            if (isTerminalStatus(result.status)) {
              setPending(false);
              setPaymentError('');
            } else if (result.status === 'HELD' && simulationFailed) {
              setPending(false);
              setPaymentError('The payment was not confirmed. You can try again while your reservation is active.');
            } else {
              setPending(true);
              setPaymentError('Payment submitted. Waiting for order confirmation…');
            }
          }
        } catch {
          if (mountedRef.current) {
            setPending(true);
            setPaymentError('Confirmation is taking longer than expected. Checking your order status…');
          }
        } finally {
          immediateStatusPendingRef.current = false;
        }
      }
    } finally {
      paymentLoadingRef.current = false;
      if (mountedRef.current) setPaymentLoading(false);
    }
  };


  const copyOrderId = async () => {
    try {
      await navigator.clipboard.writeText(order.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const terminal = isTerminalStatus(status);
  const content = statusCopy(status === 'PICKED_UP' ? 'PAID' : status);
  const Icon = status === 'PAID' || status === 'PICKED_UP'
    ? CheckCircle2
    : status === 'NEEDS_REVIEW'
      ? AlertTriangle
      : status === 'EXPIRED'
        ? Clock3
        : LoaderCircle;

  return (
    <section className="payment-layout" aria-labelledby="payment-heading">
      <div className="payment-main">
        <button type="button" className="back-link" onClick={onBackToCatalog}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to snacks
        </button>
        <div className="payment-intro">
          <div className="step-indicator"><span>02</span><span> / 02</span></div>
          <p className="eyebrow">SECURE CHECKOUT · DEMO MODE</p>
          <h1 id="payment-heading">One last step.</h1>
          <p className="page-subtitle">Confirm your demo payment and we’ll get your order ready.</p>
        </div>

        <div className={`status-card ${content.className}`}>
          <div className="status-card__icon"><Icon size={21} aria-hidden="true" /></div>
          <div className="status-card__text">
            <h2>{content.title}</h2>
            <p>{content.description}</p>
          </div>
          {!terminal && <span className="live-indicator"><span /> Live</span>}
        </div>

        {!terminal && (
          <>
            <div className="countdown-card">
              <div className="countdown-card__top">
                <div className="countdown-icon"><Clock3 size={19} aria-hidden="true" /></div>
                <div><strong>Your reservation is held</strong><p>Finish before the timer reaches zero.</p></div>
              </div>
              <div className={`countdown-value ${secondsLeft <= 15 ? 'countdown-value--urgent' : ''}`} aria-live="off">
                {formatTime(secondsLeft)}
              </div>
              <div className="countdown-progress" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (secondsLeft / Math.max(1, order.expiresInSeconds)) * 100)}%` }} />
              </div>
              <p className="countdown-footnote">Time remaining on this reservation</p>
            </div>
            
<div className="demo-payment-card">
  <div className="demo-payment-card__header">
    <div className="upi-mark">₹</div>
    <div>
      <h2>Simulated payment</h2>
      <p>Demo mode · no real money is transferred.</p>
    </div>
    <span className="demo-badge">TEST MODE</span>
  </div>

  <div className="demo-payment-instructions">
    <div className="demo-payment-graphic" aria-hidden="true">
      <div className="demo-payment-graphic__ring">
        <ShieldCheck size={38} />
      </div>
        <span>DEMO PAYMENT</span>
    </div>
    <div>
      <strong>Ready when you are</strong>
      <p>
        The server will confirm this simulated payment. No gateway or payment details are used.
      </p>
    </div>
  </div>

  <div className="payment-amount-row">
    <span>Amount due</span>
    <strong>{formatPaise(order.totalPaise)}</strong>
  </div>

  {paymentError && (
    <div className="inline-alert" role="alert">
      <AlertTriangle size={16} />
      <span>{paymentError}</span>
    </div>
  )}

  <button
    type="button"
    className="button button--primary"
    onClick={() => void startPayment()}
    disabled={paymentLoading || confirmationPending || secondsLeft <= 0}
  >
    {paymentLoading ? 'Submitting…' : confirmationPending ? 'Checking confirmation…' : `Simulate payment · ${formatPaise(order.totalPaise)}`}
  </button>
</div>

            {pollError && <div className="inline-alert"><AlertTriangle size={16} /><span>{pollError} We’ll keep retrying automatically.</span><button type="button" onClick={() => window.location.reload()} aria-label="Refresh checkout status"><RefreshCw size={15} /></button></div>}
          </>
        )}

        {terminal && (
          <div className="terminal-actions">
            {status === 'PAID' && (
              <div className="pickup-instructions">
                <CheckCircle2 size={19} aria-hidden="true" />
                <div><strong>Ready for collection</strong><p>Your order is confirmed. Use the locker claim process to collect it.</p></div>
              </div>
            )}
            <button type="button" className="button button--primary" onClick={onBackToCatalog}>Back to snack counter</button>
          </div>
        )}
      </div>

      <aside className="order-summary-card">
        <div className="order-summary-card__heading"><h2>Order summary</h2><span>#{order.id.slice(-6).toUpperCase()}</span></div>
        <div className="order-summary-card__body">
          {order.items.map((item) => (
            <div className="order-summary-item" key={`${item.productId}-${item.quantity}`}>
              <div className="order-summary-item__thumb"><ShoppingItemIcon /></div>
              <div className="order-summary-item__details"><strong>{item.quantity} × item</strong><span>Price locked at checkout</span></div>
              <strong>{formatPaise(item.pricePaise * item.quantity)}</strong>
            </div>
          ))}
        </div>
        <div className="order-summary-card__total"><span>Total to pay</span><strong>{formatPaise(order.totalPaise)}</strong></div>
        <div className="order-reference">
          <div><span>Order reference</span><strong>{order.id}</strong></div>
          <button type="button" className="icon-button" onClick={copyOrderId} aria-label="Copy order reference"><Copy size={15} /></button>
        </div>
        <p className="summary-assurance"><ShieldCheck size={15} aria-hidden="true" /> Your reservation is managed by the counter.</p>
        {copied && <p className="copy-feedback" role="status">Order reference copied</p>}
      </aside>
    </section>
  );
}

function ShoppingItemIcon() {
  return <span aria-hidden="true">▦</span>;
}
