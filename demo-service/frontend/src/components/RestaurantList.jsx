import { useState } from "react";

export default function RestaurantList({ onSearch }) {
  const [city, setCity] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();

    if (!city.trim() || !cuisine.trim()) {
      setError("Please enter both city and cuisine.");
      setResult(null);
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await onSearch(city.trim(), cuisine.trim());

      if (!response?.ok) {
        setError(
          response?.error ||
            `Unable to search restaurants (HTTP ${response?.status ?? "unknown"}).`
        );
        return;
      }

      setResult(response);
    } catch {
      setError("Unable to search restaurants. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const restaurants = Array.isArray(result?.restaurants)
    ? result.restaurants
    : [];

  return (
    <section className="card restaurant-panel">
      <div className="panel-heading">
        <div>
          <h2>Restaurants</h2>
          <p className="muted">Find restaurants by location and cuisine.</p>
        </div>
      </div>

      <form className="restaurant-form" onSubmit={submit}>
        <label htmlFor="restaurant-city">City</label>
        <input
          id="restaurant-city"
          placeholder="e.g. Hyderabad"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          disabled={loading}
        />

        <label htmlFor="restaurant-cuisine">Cuisine</label>
        <input
          id="restaurant-cuisine"
          placeholder="e.g. Indian"
          value={cuisine}
          onChange={(event) => setCuisine(event.target.value)}
          disabled={loading}
        />

        <button className="primary" type="submit" disabled={loading}>
          {loading ? "Searching..." : "Search Restaurants"}
        </button>
      </form>

      {error && (
        <p className="error message" role="alert">
          {error}
        </p>
      )}

      {result && !error && (
        <>
          <div className="search-summary">
            <strong>{restaurants.length} restaurants found</strong>
            <span>
              {result.latencyMs ?? result.duration ?? 0} ms
            </span>
          </div>

          {restaurants.length > 0 ? (
            <ul className="restaurant-results">
              {restaurants.map((restaurant, index) => (
                <li key={restaurant._id ?? `${restaurant.name}-${index}`}>
                  <strong>
                    {restaurant.name || "Unnamed restaurant"}
                  </strong>
                  <span>{restaurant.city || city}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No restaurants found for this search.</p>
          )}
        </>
      )}
    </section>
  );
}
