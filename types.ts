export type UserRole = 'admin' | 'premium' | 'buyer';
export type UserStatus = 'active' | 'suspended';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  avatarUrl?: string;
  createdAt: string;
}

export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
export type DeliveryMethod = 'shipping' | 'pickup';

export interface ShippingAddress {
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  price: number;
  imageUrl: string;
  imagePath?: string; // To manage storage deletion
  city: string;       
  pixKey: string;     
  pixKeyType: PixKeyType;
  quantity: number;
  deliveryMethod: DeliveryMethod;
  sellerId: string;
  sellerName: string;
  sellerAvatar?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  buyerId: string;
  buyerName?: string;
  sellerId: string;
  productId: string;
  productTitle: string;
  price: number;
  shippingAddress?: ShippingAddress;
  status: 'paid' | 'delivered';
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  orderId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Supabase Response Types
export interface SupabaseResponse<T> {
  data: T | null;
  error: string | null;
}