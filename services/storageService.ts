
import { Order, OrderStatus, Product, Customer, BankConfig, Notification } from '../types';
import { db } from '../firebaseConfig';
import { v4 as uuidv4 } from 'uuid';
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
  writeBatch,
  deleteField,
  limit 
} from "firebase/firestore";

const ORDER_KEY = 'ecogo_orders_v3'; 
const PRODUCT_KEY = 'ecogo_products_v1';
const CUSTOMER_KEY = 'ecogo_customers_v1';
const USER_KEY = 'ecogo_current_user';
const BANK_KEY = 'ecogo_bank_config';
const NOTIF_KEY = 'ecogo_notifications_v1';

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

  // --- Bank Configuration ---
  saveBankConfig: async (config: BankConfig): Promise<void> => {
      localStorage.setItem(BANK_KEY, JSON.stringify(config));
      if (isOnline()) {
          await setDoc(doc(db, "settings", "bankConfig"), config);
      }
  },

  getBankConfig: async (): Promise<BankConfig | null> => {
      const localData = localStorage.getItem(BANK_KEY);
      if (localData) return JSON.parse(localData);

      if (isOnline()) {
         try {
             const snap = await getDocs(collection(db, "settings"));
             let config: BankConfig | null = null;
             snap.forEach(d => {
                 if (d.id === 'bankConfig') config = d.data() as BankConfig;
             });
             if (config) {
                 localStorage.setItem(BANK_KEY, JSON.stringify(config)); 
                 return config;
             }
         } catch (e) { console.error(e); }
      }
      return null;
  },

  // --- Sync Tool ---
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
        const batch = writeBatch(db); 

        for (const order of orders) {
            const cleanOrder = {
                ...order,
                items: Array.isArray(order.items) ? order.items : [],
                updatedAt: Date.now()
            };
            const orderRef = doc(db, "orders", order.id);
            batch.set(orderRef, cleanOrder);
            count++;
        }

        for (const product of products) {
            const prodRef = doc(db, "products", product.id);
            batch.set(prodRef, product);
        }

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

  // --- Notifications System ---
  
  addNotification: async (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error', relatedOrderId?: string) => {
      const notif: Notification = {
          id: uuidv4(),
          title,
          message,
          type,
          isRead: false,
          createdAt: Date.now(),
          relatedOrderId
      };

      if (isOnline()) {
          await addDoc(collection(db, "notifications"), notif);
      } else {
          const local = localStorage.getItem(NOTIF_KEY);
          const list: Notification[] = local ? JSON.parse(local) : [];
          list.unshift(notif);
          if (list.length > 20) list.splice(20); 
          localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_notif'));
      }
  },

  subscribeNotifications: (callback: (notifs: Notification[]) => void) => {
      if (isOnline()) {
          const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(20));
          return onSnapshot(q, (snapshot) => {
              const list: Notification[] = [];
              snapshot.forEach(d => list.push({ ...d.data(), id: d.id } as Notification));
              callback(list);
          });
      } else {
          const load = () => {
              try {
                  const data = localStorage.getItem(NOTIF_KEY);
                  callback(data ? JSON.parse(data) : []);
              } catch { callback([]); }
          };
          load();
          const handler = () => load();
          window.addEventListener('storage_notif', handler);
          return () => window.removeEventListener('storage_notif', handler);
      }
  },

  markNotificationRead: async (id: string) => {
      window.dispatchEvent(new CustomEvent('local_notif_read', { detail: id }));

      if (isOnline()) {
          await updateDoc(doc(db, "notifications", id), { isRead: true });
      } else {
          const local = localStorage.getItem(NOTIF_KEY);
          if (!local) return;
          const list: Notification[] = JSON.parse(local);
          const idx = list.findIndex(n => n.id === id);
          if (idx !== -1) {
              list[idx].isRead = true;
              localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
              window.dispatchEvent(new Event('storage_notif'));
          }
      }
  },

  markAllNotificationsRead: async () => {
      window.dispatchEvent(new Event('local_notif_read_all'));

      if (isOnline()) {
          const q = query(collection(db, "notifications"), limit(20));
          const snap = await getDocs(q);
          const batch = writeBatch(db);
          let count = 0;
          snap.forEach(d => {
              if (!d.data().isRead) {
                  batch.update(d.ref, { isRead: true });
                  count++;
              }
          });
          if (count > 0) await batch.commit();
      } else {
          const local = localStorage.getItem(NOTIF_KEY);
          if (!local) return;
          const list: Notification[] = JSON.parse(local).map((n: Notification) => ({ ...n, isRead: true }));
          localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_notif'));
      }
  },

  clearAllNotifications: async () => {
      window.dispatchEvent(new Event('local_notif_clear_all'));

      if (isOnline()) {
          const q = query(collection(db, "notifications"), limit(50));
          const snap = await getDocs(q);
          const batch = writeBatch(db);
          snap.forEach(d => {
              batch.delete(d.ref);
          });
          await batch.commit();
      } else {
          localStorage.setItem(NOTIF_KEY, JSON.stringify([]));
          window.dispatchEvent(new Event('storage_notif'));
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
        orders.sort((a, b) => b.createdAt - a.createdAt);
        callback(orders);
      });
    } else {
      const loadLocal = () => {
        try {
          const data = localStorage.getItem(ORDER_KEY);
          if (!data) { callback([]); return; }
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
    
    await storageService.deductInventory(order);
    storageService.upsertCustomer({
      name: order.customerName,
      phone: order.customerPhone,
      address: order.address,
      id: order.customerPhone || order.customerName,
      lastOrderDate: Date.now()
    });

    storageService.addNotification(
        order.customerName, 
        `Đã tạo đơn mới • ${order.address}`,
        'success',
        order.id
    );
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
    
    storageService.addNotification(
        updatedOrder.customerName, 
        `Đã chỉnh sửa chi tiết • ${updatedOrder.address}`, 
        'info', 
        updatedOrder.id
    );
  },

  updateStatus: async (id: string, status: OrderStatus, proof?: string, context?: { name: string, address: string }): Promise<Order | null> => {
    const currentUser = storageService.getCurrentUser() || 'Admin';
    const updateData: any = { 
        status, 
        updatedAt: Date.now(),
        lastUpdatedBy: currentUser
    };
    if (proof) updateData.deliveryProof = proof;

    if (isOnline()) {
      await updateDoc(doc(db, "orders", id), updateData);
    } else {
      const orders = storageService.getOrdersSync();
      const index = orders.findIndex(o => o.id === id);
      if (index !== -1) {
          orders[index] = { ...orders[index], ...updateData };
          localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
          window.dispatchEvent(new Event('storage'));
      }
    }

    const orderName = context?.name || 'Khách hàng';
    const address = context?.address || '';

    let statusMsg = '';
    if (status === OrderStatus.PICKED_UP) statusMsg = 'Đã lấy hàng';
    if (status === OrderStatus.IN_TRANSIT) statusMsg = 'Đang đi giao';
    if (status === OrderStatus.DELIVERED) statusMsg = 'Giao thành công';
    if (status === OrderStatus.CANCELLED) statusMsg = 'Đã hủy';
    
    if (statusMsg) {
        storageService.addNotification(
            orderName, 
            `${statusMsg} • ${address}`,
            status === OrderStatus.CANCELLED ? 'error' : (status === OrderStatus.DELIVERED ? 'success' : 'info'),
            id
        );
    }

    return null;
  },

  splitOrderToNextBatch: async (id: string, currentBatchId: string): Promise<void> => {
      const newBatchId = `${currentBatchId}S`;
      const currentUser = storageService.getCurrentUser() || 'Admin';
      
      if (isOnline()) {
          await updateDoc(doc(db, "orders", id), { 
              batchId: newBatchId,
              updatedAt: Date.now(),
              lastUpdatedBy: currentUser
          });
      } else {
          const orders = storageService.getOrdersSync();
          const index = orders.findIndex(o => o.id === id);
          if (index !== -1) {
              orders[index].batchId = newBatchId;
              orders[index].updatedAt = Date.now();
              orders[index].lastUpdatedBy = currentUser;
              localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
              window.dispatchEvent(new Event('storage'));
          }
      }
  },

  deleteDeliveryProof: async (id: string): Promise<void> => {
      if (isOnline()) {
          await updateDoc(doc(db, "orders", id), {
              deliveryProof: deleteField(),
              updatedAt: Date.now()
          });
      } else {
          const orders = storageService.getOrdersSync();
          const index = orders.findIndex(o => o.id === id);
          if (index !== -1) {
              delete orders[index].deliveryProof;
              orders[index].updatedAt = Date.now();
              localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
              window.dispatchEvent(new Event('storage'));
          }
      }
  },
  
  updatePaymentVerification: async (id: string, verified: boolean, context?: { name: string }): Promise<void> => {
      const currentUser = storageService.getCurrentUser() || 'Admin';
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
      
      const orderName = context?.name || 'Khách hàng';
      
      if (verified) {
          storageService.addNotification(orderName, `Đã xác nhận thanh toán • Duyệt bởi ${currentUser}`, 'success', id);
      }
  },

  deleteOrder: async (id: string, context?: { name: string, address: string }): Promise<void> => {
    const orderName = context?.name || 'Đơn hàng';
    const address = context?.address || '';

    if (isOnline()) {
      await deleteDoc(doc(db, "orders", id));
    } else {
      const orders = storageService.getOrdersSync();
      const filtered = orders.filter(o => o.id !== id);
      localStorage.setItem(ORDER_KEY, JSON.stringify(filtered));
      window.dispatchEvent(new Event('storage'));
    }
    
    storageService.addNotification(orderName, `Đã xóa đơn hàng • ${address}`, 'warning', id);
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

  // --- Inventory (Products) & Customers ---
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
      if (item.productId) productIndex = products.findIndex(p => p.id === item.productId);
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
          if (isOnline()) updateDoc(doc(db, "products", product.id), { stockQuantity: products[productIndex].stockQuantity });
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
      return products.map((p: any) => ({ ...p, totalImported: p.totalImported ?? p.stockQuantity }));
    } catch { return []; }
  },

  saveProduct: async (product: Product): Promise<void> => {
    if (isOnline()) {
        await setDoc(doc(db, "products", product.id), product);
    } else {
        const products = storageService.getProductsSync();
        const index = products.findIndex(p => p.id === product.id);
        if (index >= 0) products[index] = product; else products.push(product);
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

  subscribeCustomers: (callback: (customers: Customer[]) => void) => {
      if (isOnline()) {
          const q = query(collection(db, "customers"), orderBy("priorityScore", "asc"), limit(2000)); // Optimize query
          return onSnapshot(q, (snapshot) => {
              const customers: Customer[] = [];
              snapshot.forEach(d => customers.push(d.data() as Customer));
              callback(customers);
          });
      } else {
           const load = () => {
              try { 
                  const data = localStorage.getItem(CUSTOMER_KEY); 
                  const list = data ? JSON.parse(data) : [];
                  list.sort((a:Customer,b:Customer) => (a.priorityScore || 999) - (b.priorityScore || 999));
                  callback(list);
              } catch { callback([]); }
           };
           load();
           const handler = () => load();
           window.addEventListener('storage', handler);
           return () => window.removeEventListener('storage', handler);
      }
  },

  getCustomersSync: (): Customer[] => {
    try { const data = localStorage.getItem(CUSTOMER_KEY); return data ? JSON.parse(data) : []; } catch { return []; }
  },

  upsertCustomer: async (customerData: Customer): Promise<void> => {
      // Ensure priority score is preserved or defaulted
      const dataToSave = { ...customerData, priorityScore: customerData.priorityScore ?? 999 };

      if (isOnline()) {
          await setDoc(doc(db, "customers", dataToSave.id), dataToSave, { merge: true });
      } else {
        const customers = storageService.getCustomersSync();
        const index = customers.findIndex(c => (dataToSave.phone && c.phone === dataToSave.phone) || c.name.toLowerCase() === dataToSave.name.toLowerCase());
        if (index >= 0) customers[index] = { ...customers[index], ...dataToSave }; else customers.push(dataToSave);
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customers));
        window.dispatchEvent(new Event('storage'));
      }
  },

  deleteCustomer: async (id: string): Promise<void> => {
      if (isOnline()) { await deleteDoc(doc(db, "customers", id)); } else {
          const customers = storageService.getCustomersSync();
          const filtered = customers.filter(c => c.id !== id);
          localStorage.setItem(CUSTOMER_KEY, JSON.stringify(filtered));
          window.dispatchEvent(new Event('storage'));
      }
  },

  clearAllCustomers: async (): Promise<void> => {
      if (isOnline()) {
          const q = query(collection(db, "customers"), limit(500));
          const snap = await getDocs(q);
          const batch = writeBatch(db);
          snap.forEach(d => batch.delete(d.ref));
          await batch.commit();
          // If more than 500, user needs to click again. Firestore limitation for batch.
      } else {
          localStorage.setItem(CUSTOMER_KEY, JSON.stringify([]));
          window.dispatchEvent(new Event('storage'));
      }
  },

  importCustomersBatch: async (customers: Customer[]): Promise<number> => {
      if (customers.length === 0) return 0;
      if (isOnline()) {
          const batch = writeBatch(db);
          // Process in chunks of 500 if array is large
          let opCount = 0;
          for (const c of customers) {
              const ref = doc(db, "customers", c.id);
              batch.set(ref, c, { merge: true });
              opCount++;
              if (opCount >= 490) break; // Safety limit per batch
          }
          await batch.commit();
          return opCount;
      } else {
          const existing = storageService.getCustomersSync();
          customers.forEach(c => {
            const index = existing.findIndex(ex => ex.id === c.id || (ex.phone && ex.phone === c.phone));
            if (index >= 0) existing[index] = { ...existing[index], ...c }; else existing.push(c);
          });
          localStorage.setItem(CUSTOMER_KEY, JSON.stringify(existing));
          window.dispatchEvent(new Event('storage'));
          return customers.length;
      }
  },

  autoSortOrders: async (orders: Order[]): Promise<void> => {
      let customers: Customer[] = [];
      if (isOnline()) {
          const snap = await getDocs(collection(db, "customers"));
          snap.forEach(d => customers.push(d.data() as Customer));
      } else {
          customers = storageService.getCustomersSync();
      }

      // Sort by priority score (ascending: 1 is high priority) -> then undefined
      const sorted = [...orders].sort((a, b) => {
          const custA = customers.find(c => c.phone === a.customerPhone);
          const custB = customers.find(c => c.phone === b.customerPhone);
          
          const scoreA = custA?.priorityScore ?? 999;
          const scoreB = custB?.priorityScore ?? 999;
          
          return scoreA - scoreB;
      });

      await storageService.saveOrdersList(sorted.map((o, idx) => ({ ...o, orderIndex: idx })));
  }
};