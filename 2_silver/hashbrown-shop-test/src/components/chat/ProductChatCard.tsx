import { formatPrice } from '../../data/products';
import { findProduct, useShopStore } from '../../store';

export const ProductChatCard = (props: { productId: string }) => {
  const addToCart = useShopStore((s) => s.addToCart);
  const product = findProduct(props.productId);

  if (!product) {
    return <div className="chat-product-card">상품을 찾을 수 없습니다 ({props.productId})</div>;
  }

  return (
    <div className="chat-product-card">
      <div className="chat-product-emoji">{product.emoji}</div>
      <div className="chat-product-info">
        <strong>{product.name}</strong>
        <span className="chat-product-desc">{product.description}</span>
        <span className="chat-product-price">{formatPrice(product.price)}</span>
      </div>
      <button className="chat-product-add" onClick={() => addToCart(product.id)}>
        담기
      </button>
    </div>
  );
};
