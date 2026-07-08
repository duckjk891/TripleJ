import { cartTotal, findProduct, useShopStore } from '../store';
import { formatPrice } from '../data/products';

export function CartPanel() {
  const cart = useShopStore((s) => s.cart);
  const orders = useShopStore((s) => s.orders);
  const setQuantity = useShopStore((s) => s.setQuantity);
  const removeFromCart = useShopStore((s) => s.removeFromCart);
  const checkout = useShopStore((s) => s.checkout);

  return (
    <div className="cart-panel">
      <h2>🛒 장바구니</h2>
      {cart.length === 0 ? (
        <p className="cart-empty">장바구니가 비어 있습니다.</p>
      ) : (
        <>
          <ul className="cart-list">
            {cart.map((item) => {
              const product = findProduct(item.productId);
              if (!product) return null;
              return (
                <li key={item.productId} className="cart-item">
                  <span className="cart-item-name">
                    {product.emoji} {product.name}
                  </span>
                  <span className="cart-item-controls">
                    <button onClick={() => setQuantity(item.productId, item.quantity - 1)}>−</button>
                    <span className="cart-qty">{item.quantity}</span>
                    <button onClick={() => setQuantity(item.productId, item.quantity + 1)}>+</button>
                    <span className="cart-item-price">
                      {formatPrice(product.price * item.quantity)}
                    </span>
                    <button className="cart-remove" onClick={() => removeFromCart(item.productId)}>
                      삭제
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="cart-total">
            <strong>합계: {formatPrice(cartTotal(cart))}</strong>
            <button className="checkout-btn" onClick={() => checkout()}>
              주문하기
            </button>
          </div>
        </>
      )}
      {orders.length > 0 && (
        <div className="order-history">
          <h3>📦 주문 내역</h3>
          <ul>
            {orders.map((order) => (
              <li key={order.id}>
                <strong>{order.id}</strong> · {order.orderedAt} ·{' '}
                {order.items.map((i) => `${i.product.name} ×${i.quantity}`).join(', ')} ·{' '}
                <strong>{formatPrice(order.total)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
