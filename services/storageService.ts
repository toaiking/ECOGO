
import { Order, OrderStatus, Product, Customer } from '../types';
import { db } from '../firebaseConfig';
import { 
  collection, 
  addDoc, 
  setDoc,
  doc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy,
  getDocs,
  writeBatch
} from "firebase/firestore";

const ORDER_KEY = 'ecogo_orders_v3'; 
const PRODUCT_KEY = 'ecogo_products_v1';
const CUSTOMER_KEY = 'ecogo_customers_v1';
const USER_KEY = 'ecogo_current_user';

// Helper to determine if we use Firebase
const isOnline = () => !!db;

export const storageService = {
  // --- Auth / User ---
  login: (username: string) => {
    localStorage.setItem(USER_KEY, username);
  },
  logout: () => {
    localStorage.removeItem(USER_KEY);
  },
  getCurrentUser: (): string | null => {
    return localStorage.getItem(USER_KEY);
  },

  // --- Sync Tool (New) ---
  syncLocalToCloud: async (): Promise<number> => {
    if (!isOnline()) throw new Error("Chưa kết nối Firebase");
    
    try {
        const localOrdersRaw = localStorage.getItem(ORDER_KEY);
        const localProductsRaw = localStorage.getItem(PRODUCT_KEY);
        const localCustomersRaw = localStorage.getItem(CUSTOMER_KEY);

        const orders: Order[] = localOrdersRaw ? JSON.parse(localOrdersRaw) : [];
        const products: Product[] = localProductsRaw ? JSON.parse(localProductsRaw) : [];
        const customers: Customer[] = localCustomersRaw ? JSON.parse(localCustomersRaw) : [];

        let count = 0;
        const batch = writeBatch(db); // Use batch for atomicity (limit 500 ops)

        // 1. Sync Orders
        for (const order of orders) {
            // Fix data structure if needed
            const cleanOrder = {
                ...order,
                items: Array.isArray(order.items) ? order.items : [],
                updatedAt: Date.now()
            };
            const orderRef = doc(db, "orders", order.id);
            batch.set(orderRef, cleanOrder);
            count++;
        }

        // 2. Sync Products
        for (const product of products) {
            const prodRef = doc(db, "products", product.id);
            batch.set(prodRef, product);
        }

        // 3. Sync Customers
        for (const customer of customers) {
             const cid = customer.id || customer.phone || customer.name;
             if (cid) {
                 const custRef = doc(db, "customers", cid);
                 batch.set(custRef, customer);
             }
        }

        await batch.commit();
        return count;
    } catch (error) {
        console.error("Sync error:", error);
        throw error;
    }
  },

  // --- Orders (Real-time & Sync) ---
  
  subscribeOrders: (callback: (orders: Order[]) => void) => {
    if (isOnline()) {
      const q = query(collection(db, "orders")); 
      return onSnapshot(q, (snapshot) => {
        const orders: Order[] = [];
        snapshot.forEach((doc) => {
          orders.push(doc.data() as Order);
        });
        // Sort client side 
        orders.sort((a, b) => b.createdAt - a.createdAt);
        callback(orders);
      });
    } else {
      const loadLocal = () => {
        try {
          const data = localStorage.getItem(ORDER_KEY);
          if (!data) {
             callback([]);
             return;
          }
          const orders = JSON.parse(data).map((o: any) => ({
            ...o,
            items: Array.isArray(o.items) ? o.items : [{ id: 'migrated', name: o.items || 'Hàng hóa', quantity: 1, price: o.price || 0 }],
            totalPrice: o.totalPrice || o.price || 0,
            orderIndex: o.orderIndex !== undefined ? o.orderIndex : 0,
            paymentVerified: o.paymentVerified || false
          }));
          callback(orders);
        } catch (e) { callback([]); }
      };
      
      loadLocal();
      const handler = () => loadLocal();
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    }
  },

  getOrdersSync: (): Order[] => {
     try {
      const data = localStorage.getItem(ORDER_KEY);
      if (!data) return [];
      return JSON.parse(data).map((o: any) => ({
        ...o,
        items: Array.isArray(o.items) ? o.items : [{ id: 'migrated', name: o.items || 'Hàng hóa', quantity: 1, price: o.price || 0 }],
        totalPrice: o.totalPrice || o.price || 0,
        orderIndex: o.orderIndex !== undefined ? o.orderIndex : 0,
        paymentVerified: o.paymentVerified || false
      }));
    } catch { return []; }
  },

  saveOrder: async (order: Order): Promise<void> => {
    if (isOnline()) {
      await setDoc(doc(db, "orders", order.id), order);
    } else {
      const orders = storageService.getOrdersSync();
      orders.unshift(order);
      localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
      window.dispatchEvent(new Event('storage'));
    }
    
    // Inventory Deduct Logic
    await storageService.deductInventory(order);

    // Customer Save Logic
    storageService.upsertCustomer({
      name: order.customerName,
      phone: order.customerPhone,
      address: order.address,
      id: order.customerPhone || order.customerName,
      lastOrderDate: Date.now()
    });
  },

  updateOrderDetails: async (updatedOrder: Order): Promise<void> => {
    const finalOrder = { ...updatedOrder, updatedAt: Date.now() };
    if (isOnline()) {
      await updateDoc(doc(db, "orders", updatedOrder.id), finalOrder);
    } else {
      const orders = storageService.getOrdersSync();
      const index = orders.findIndex(o => o.id === updatedOrder.id);
      if (index !== -1) {
        orders[index] = finalOrder;
        localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
        window.dispatchEvent(new Event('storage'));
      }
    }
  },

  updateStatus: async (id: string, status: OrderStatus, proof?: string): Promise<Order | null> => {
    const currentUser = storageService.getCurrentUser() || 'Admin';
    const updateData: any = { 
        status, 
        updatedAt: Date.now(),
        lastUpdatedBy: currentUser
    };
    if (proof) updateData.deliveryProof = proof;

    if (isOnline()) {
      await updateDoc(doc(db, "orders", id), updateData);
      return null;
    } else {
      const orders = storageService.getOrdersSync();
      const index = orders.findIndex(o => o.id === id);
      if (index === -1) return null;
      orders[index] = { ...orders[index], ...updateData };
      localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
      window.dispatchEvent(new Event('storage'));
      return orders[index];
    }
  },
  
  updatePaymentVerification: async (id: string, verified: boolean): Promise<void> => {
      if (isOnline()) {
          await updateDoc(doc(db, "orders", id), { paymentVerified: verified, updatedAt: Date.now() });
      } else {
          const orders = storageService.getOrdersSync();
          const index = orders.findIndex(o => o.id === id);
          if (index !== -1) {
              orders[index].paymentVerified = verified;
              localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
              window.dispatchEvent(new Event('storage'));
          }
      }
  },

  deleteOrder: async (id: string): Promise<void> => {
    if (isOnline()) {
      await deleteDoc(doc(db, "orders", id));
    } else {
      const orders = storageService.getOrdersSync();
      const filtered = orders.filter(o => o.id !== id);
      localStorage.setItem(ORDER_KEY, JSON.stringify(filtered));
      window.dispatchEvent(new Event('storage'));
    }
  },

  saveOrdersList: async (orders: Order[]): Promise<void> => {
      if (isOnline()) {
          const batch = writeBatch(db);
          orders.forEach(o => {
              const ref = doc(db, "orders", o.id);
              batch.update(ref, { orderIndex: o.orderIndex });
          });
          await batch.commit();
      } else {
          localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
          window.dispatchEvent(new Event('storage'));
      }
  },

  // --- Inventory ---

  deductInventory: async (order: Order) => {
    let products: Product[] = [];
    if (isOnline()) {
        const snap = await getDocs(collection(db, "products"));
        snap.forEach(d => products.push(d.data() as Product));
    } else {
        products = storageService.getProductsSync();
    }

    let inventoryChanged = false;

    order.items.forEach(item => {
      let productIndex = -1;
      if (item.productId) {
        productIndex = products.findIndex(p => p.id === item.productId);
      }
      if (productIndex === -1 && item.name) {
        const normalizedItemName = item.name.trim().toLowerCase();
        productIndex = products.findIndex(p => {
            const pName = p.name.trim().toLowerCase();
            return pName === normalizedItemName || pName.includes(normalizedItemName) || normalizedItemName.includes(pName);
        });
      }

      if (productIndex !== -1) {
        const product = products[productIndex];
        const weightPerUnit = product.defaultWeight > 0 ? product.defaultWeight : 1;
        const weightToDeduct = (item.quantity || 1) * weightPerUnit;
        
        if (weightToDeduct > 0) {
          products[productIndex].stockQuantity = Math.max(0, (products[productIndex].stockQuantity || 0) - weightToDeduct);
          inventoryChanged = true;
          
          if (isOnline()) {
              updateDoc(doc(db, "products", product.id), { stockQuantity: products[productIndex].stockQuantity });
          }
        }
      }
    });

    if (!isOnline() && inventoryChanged) {
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(products));
      window.dispatchEvent(new Event('storage'));
    }
  },

  subscribeProducts: (callback: (products: Product[]) => void) => {
    if (isOnline()) {
        return onSnapshot(collection(db, "products"), (snapshot) => {
            const products: Product[] = [];
            snapshot.forEach(d => products.push(d.data() as Product));
            callback(products);
        });
    } else {
        const load = () => callback(storageService.getProductsSync());
        load();
        const handler = () => load();
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }
  },

  getProductsSync: (): Product[] => {
    try {
      const data = localStorage.getItem(PRODUCT_KEY);
      const products = data ? JSON.parse(data) : [];
      return products.map((p: any) => ({
          ...p,
          totalImported: p.totalImported ?? p.stockQuantity 
      }));
    } catch { return []; }
  },

  saveProduct: async (product: Product): Promise<void> => {
    if (isOnline()) {
        await setDoc(doc(db, "products", product.id), product);
    } else {
        const products = storageService.getProductsSync();
        const index = products.findIndex(p => p.id === product.id);
        if (index >= 0) products[index] = product;
        else products.push(product);
        localStorage.setItem(PRODUCT_KEY, JSON.stringify(products));
        window.dispatchEvent(new Event('storage'));
    }
  },

  deleteProduct: async (id: string): Promise<void> => {
      if (isOnline()) {
          await deleteDoc(doc(db, "products", id));
      } else {
          const products = storageService.getProductsSync();
          const filtered = products.filter(p => p.id !== id);
          localStorage.setItem(PRODUCT_KEY, JSON.stringify(filtered));
          window.dispatchEvent(new Event('storage'));
      }
  },

  // --- Customers ---
  
  subscribeCustomers: (callback: (customers: Customer[]) => void) => {
      if (isOnline()) {
          return onSnapshot(collection(db, "customers"), (snapshot) => {
              const customers: Customer[] = [];
              snapshot.forEach(d => customers.push(d.data() as Customer));
              callback(customers);
          });
      } else {
           const load = () => {
              try {
                  const data = localStorage.getItem(CUSTOMER_KEY);
                  callback(data ? JSON.parse(data) : []);
              } catch { callback([]); }
           };
           load();
           const handler = () => load();
           window.addEventListener('storage', handler);
           return () => window.removeEventListener('storage', handler);
      }
  },

  getCustomersSync: (): Customer[] => {
    try {
      const data = localStorage.getItem(CUSTOMER_KEY);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  },

  upsertCustomer: async (customerData: Customer): Promise<void> => {
      if (isOnline()) {
          await setDoc(doc(db, "customers", customerData.id), customerData, { merge: true });
      } else {
        const customers = storageService.getCustomersSync();
        const index = customers.findIndex(c => 
            (customerData.phone && c.phone === customerData.phone) || 
            c.name.toLowerCase() === customerData.name.toLowerCase()
        );
        if (index >= 0) customers[index] = { ...customers[index], ...customerData };
        else customers.push(customerData);
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customers));
        window.dispatchEvent(new Event('storage'));
      }
  },

  deleteCustomer: async (id: string): Promise<void> => {
      if (isOnline()) {
          await deleteDoc(doc(db, "customers", id));
      } else {
          const customers = storageService.getCustomersSync();
          const filtered = customers.filter(c => c.id !== id);
          localStorage.setItem(CUSTOMER_KEY, JSON.stringify(filtered));
          window.dispatchEvent(new Event('storage'));
      }
  },

  importCustomersBatch: async (customers: Customer[]): Promise<number> => {
      if (customers.length === 0) return 0;

      if (isOnline()) {
          const batch = writeBatch(db);
          customers.forEach(c => {
              const ref = doc(db, "customers", c.id);
              batch.set(ref, c, { merge: true });
          });
          await batch.commit();
      } else {
          const existing = storageService.getCustomersSync();
          customers.forEach(c => {
            const index = existing.findIndex(ex => ex.id === c.id || (ex.phone && ex.phone === c.phone));
            if (index >= 0) existing[index] = { ...existing[index], ...c };
            else existing.push(c);
          });
          localStorage.setItem(CUSTOMER_KEY, JSON.stringify(existing));
          window.dispatchEvent(new Event('storage'));
      }
      return customers.length;
  }
};
