import { PRODUCTS, formatPrice } from '../data/products';
import { useShopStore } from '../store';

export function ProductGrid() {
  const addToCart = useShopStore((s) => s.addToCart);

  return (
    <div className="product-grid">
      {PRODUCTS.map((product) => (
        <div key={product.id} className="product-card">
          <div className="product-emoji">{product.emoji}</div>
          <div className="product-category">{product.category}</div>
          <h3>{product.name}</h3>
          <p className="product-desc">{product.description}</p>
          <div className="product-footer">
            <span className="product-price">{formatPrice(product.price)}</span>
            <button onClick={() => addToCart(product.id)}>담기</button>
          </div>
        </div>
      ))}
    </div>
  );
}
