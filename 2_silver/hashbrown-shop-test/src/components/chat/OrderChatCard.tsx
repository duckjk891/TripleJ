import { formatPrice } from '../../data/products';
import { useShopStore } from '../../store';

export const OrderChatCard = (props: { orderId: string }) => {
  const order = useShopStore((s) => s.orders.find((o) => o.id === props.orderId));

  if (!order) {
    return <div className="chat-order-card">주문을 찾을 수 없습니다 ({props.orderId})</div>;
  }

  return (
    <div className="chat-order-card">
      <strong>✅ 주문 완료 — {order.id}</strong>
      <ul>
        {order.items.map((item) => (
          <li key={item.product.id}>
            {item.product.emoji} {item.product.name} ×{item.quantity} ={' '}
            {formatPrice(item.product.price * item.quantity)}
          </li>
        ))}
      </ul>
      <strong>결제 금액: {formatPrice(order.total)}</strong>
      <span className="chat-order-date">{order.orderedAt}</span>
    </div>
  );
};
