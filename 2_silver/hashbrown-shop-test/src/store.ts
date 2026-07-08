import { create } from 'zustand';
import { PRODUCTS, Product } from './data/products';

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Order {
  id: string;
  items: { product: Product; quantity: number }[];
  total: number;
  orderedAt: string;
}

interface ShopState {
  cart: CartItem[];
  orders: Order[];
  addToCart: (productId: string, quantity?: number) => { ok: boolean; message: string };
  removeFromCart: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  checkout: () => { ok: boolean; message: string; order?: Order };
}

export const findProduct = (productId: string) =>
  PRODUCTS.find((p) => p.id === productId);

export const cartTotal = (cart: CartItem[]) =>
  cart.reduce((sum, item) => {
    const product = findProduct(item.productId);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);

export const useShopStore = create<ShopState>((set, get) => ({
  cart: [],
  orders: [],

  addToCart: (productId, quantity = 1) => {
    const product = findProduct(productId);
    if (!product) {
      return { ok: false, message: `상품을 찾을 수 없습니다: ${productId}` };
    }
    if (quantity < 1) {
      return { ok: false, message: '수량은 1 이상이어야 합니다.' };
    }
    set((state) => {
      const existing = state.cart.find((item) => item.productId === productId);
      if (existing) {
        return {
          cart: state.cart.map((item) =>
            item.productId === productId
              ? { ...item, quantity: item.quantity + quantity }
              : item,
          ),
        };
      }
      return { cart: [...state.cart, { productId, quantity }] };
    });
    return { ok: true, message: `${product.name} ${quantity}개를 장바구니에 담았습니다.` };
  },

  removeFromCart: (productId) => {
    set((state) => ({
      cart: state.cart.filter((item) => item.productId !== productId),
    }));
  },

  setQuantity: (productId, quantity) => {
    set((state) => ({
      cart:
        quantity < 1
          ? state.cart.filter((item) => item.productId !== productId)
          : state.cart.map((item) =>
              item.productId === productId ? { ...item, quantity } : item,
            ),
    }));
  },

  clearCart: () => set({ cart: [] }),

  checkout: () => {
    const { cart } = get();
    if (cart.length === 0) {
      return { ok: false, message: '장바구니가 비어 있어 주문할 수 없습니다.' };
    }
    const order: Order = {
      id: `ORD-${String(get().orders.length + 1).padStart(4, '0')}`,
      items: cart.map((item) => ({
        product: findProduct(item.productId)!,
        quantity: item.quantity,
      })),
      total: cartTotal(cart),
      orderedAt: new Date().toLocaleString('ko-KR'),
    };
    set((state) => ({ orders: [...state.orders, order], cart: [] }));
    return { ok: true, message: `주문이 완료되었습니다. 주문번호: ${order.id}`, order };
  },
}));
