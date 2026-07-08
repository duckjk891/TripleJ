import { formatPrice } from '../../data/products';
import { cartTotal, findProduct, useShopStore } from '../../store';

export const CartChatCard = () => {
  const cart = useShopStore((s) => s.cart);

  if (cart.length === 0) {
    return <div className="chat-cart-card">장바구니가 비어 있습니다.</div>;
  }

  return (
    <div className="chat-cart-card">
      <strong>🛒 현재 장바구니</strong>
      <ul>
        {cart.map((item) => {
          const product = findProduct(item.productId);
          if (!product) return null;
          return (
            <li key={item.productId}>
              {product.emoji} {product.name} ×{item.quantity} ={' '}
              {formatPrice(product.price * item.quantity)}
            </li>
          );
        })}
      </ul>
      <strong>합계: {formatPrice(cartTotal(cart))}</strong>
    </div>
  );
};
