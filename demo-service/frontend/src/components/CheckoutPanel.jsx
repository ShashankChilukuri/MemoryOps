import { useState } from "react";

export default function CheckoutPanel({ onCheckout }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await onCheckout();

      if (!response?.ok) {
        setError(
          response?.error ||
            `Checkout failed (HTTP ${response?.status ?? "unknown"}).`
        );
      } else {
        setResult(response);
      }
    } catch {
      setError("Checkout could not be completed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card checkout-panel">
      <h2>Checkout</h2>
      <p className="muted">
        Test the checkout flow and observe the API response.
      </p>

      <div className="checkout-action">
        <button
          className="primary"
          type="button"
          onClick={submit}
          disabled={loading}
        >
          {loading ? "Processing order..." : "Place Demo Order"}
        </button>
      </div>

      {loading && (
        <p className="muted" role="status">
          Sending checkout request...
        </p>
      )}

      {error && (
        <div className="checkout-result checkout-error" role="alert">
          <strong>Checkout unsuccessful</strong>
          <p>{error}</p>
          {result?.status != null && (
            <small>HTTP status: {result.status}</small>
          )}
          {result?.duration != null && (
            <small>Response time: {result.duration} ms</small>
          )}
        </div>
      )}

      {result && (
        <div className="checkout-result checkout-success" role="status">
          <strong>Order placed successfully</strong>
          {result.orderId && <p>Order ID: {result.orderId}</p>}
          {result.duration != null && (
            <p>Response time: {result.duration} ms</p>
          )}
        </div>
      )}
    </section>
  );
}
