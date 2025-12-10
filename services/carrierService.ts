
import { Order, CarrierData } from '../types';

export const CARRIERS = [
    { id: 'GHTK', name: 'Giao Hàng Tiết Kiệm', shortName: 'GHTK', color: 'bg-green-600', border: 'border-green-600', text: 'text-green-600', baseFee: 16500, speed: 'fast' },
    { id: 'GHN', name: 'Giao Hàng Nhanh', shortName: 'GHN', color: 'bg-orange-600', border: 'border-orange-600', text: 'text-orange-600', baseFee: 18000, speed: 'fast' },
    { id: 'VTP', name: 'Viettel Post', shortName: 'Viettel', color: 'bg-red-700', border: 'border-red-700', text: 'text-red-700', baseFee: 22000, speed: 'normal' },
    { id: 'AHA', name: 'AhaMove (Siêu Tốc)', shortName: 'AhaMove', color: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-500', baseFee: 35000, speed: 'instant' }
];

export interface CarrierQuote {
    carrierId: string;
    name: string;
    shortName: string;
    fee: number;
    color: string;
    isBestPrice?: boolean;
    isFastest?: boolean;
}

export const carrierService = {
    calculateFee: async (carrierId: string, weight: number): Promise<number> => {
        // Mock calculation logic
        const carrier = CARRIERS.find(c => c.id === carrierId);
        if (!carrier) return 0;

        let fee = carrier.baseFee;
        
        // Weight fee: 100d per 100g over 1kg
        if (weight > 1000) {
            fee += Math.ceil((weight - 1000) / 100) * 500;
        }

        // Random slight variance to simulate real API fluctuations
        const variance = Math.floor(Math.random() * 1500); 
        return fee + variance;
    },

    getQuotes: async (weight: number): Promise<CarrierQuote[]> => {
        // Simulate network latency (faster than individual calls)
        await new Promise(r => setTimeout(r, 800));

        const promises = CARRIERS.map(async (c) => {
            const fee = await carrierService.calculateFee(c.id, weight);
            return {
                carrierId: c.id,
                name: c.name,
                shortName: c.shortName,
                color: c.color, // Using bg color class
                fee: fee,
                speedType: c.speed
            };
        });

        const results = await Promise.all(promises);
        
        // Find best price
        const minFee = Math.min(...results.map(r => r.fee));
        
        return results.map(r => ({
            ...r,
            isBestPrice: r.fee === minFee,
            isFastest: r.speedType === 'instant'
        })).sort((a, b) => a.fee - b.fee); // Sort cheapest first
    },

    createShipment: async (order: Order, carrierId: string, weight: number, cod: number): Promise<CarrierData> => {
        await new Promise(r => setTimeout(r, 1000)); // Simulate API call
        
        const carrier = CARRIERS.find(c => c.id === carrierId)!;
        const prefix = carrierId;
        // Generate realistic looking tracking code
        const randomCode = Math.floor(Math.random() * 1000000000).toString();
        const trackingCode = carrierId === 'GHTK' ? `S${randomCode.slice(0,9)}.${order.id}` : `${prefix}${randomCode}`;
        
        // Recalculate exact fee one last time to be sure
        const fee = await carrierService.calculateFee(carrierId, weight);

        return {
            carrierId: carrierId,
            carrierName: carrier.name,
            trackingCode: trackingCode,
            fee: fee,
            weight,
            cod,
            createdAt: Date.now()
        };
    },
    
    printWaybill: (order: Order) => {
        if (!order.carrierData) return;
        const { carrierData } = order;
        const carrier = CARRIERS.find(c => c.id === carrierData.carrierId) || CARRIERS[0];
        
        const w = window.open('', '_blank', 'width=400,height=600');
        if (!w) return;
        
        const dateStr = new Date().toLocaleString('vi-VN');
        
        // Simple HTML for Waybill (A6 size ratio roughly)
        w.document.write(`
            <html>
                <head>
                    <title>${carrierData.trackingCode}</title>
                    <style>
                        body { font-family: 'Arial', sans-serif; border: 2px dashed #333; width: 360px; padding: 15px; margin: 10px auto; color: #000; }
                        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
                        .brand { font-size: 20px; font-weight: 900; text-transform: uppercase; }
                        .date { font-size: 10px; }
                        .barcode-box { background: #f0f0f0; padding: 15px 0; margin: 15px 0; text-align: center; border-radius: 4px; }
                        .barcode { font-family: 'Courier New', monospace; font-size: 24px; font-weight: bold; letter-spacing: 2px; display: block; }
                        .code-label { font-size: 10px; color: #666; text-transform: uppercase; margin-top: 5px; display: block;}
                        
                        .section { margin-bottom: 15px; }
                        .row { display: flex; margin-bottom: 6px; font-size: 13px; line-height: 1.4; }
                        .label { width: 90px; font-weight: bold; color: #444; flex-shrink: 0; }
                        .val { font-weight: 600; flex-grow: 1; }
                        .val.large { font-size: 16px; font-weight: 800; }
                        .val.address { font-size: 12px; }
                        
                        .money-box { border: 2px solid #000; padding: 10px; text-align: center; margin-top: 20px; border-radius: 8px; }
                        .money-label { font-size: 12px; font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 5px; }
                        .money-val { font-size: 28px; font-weight: 900; }
                        
                        .footer { margin-top: 20px; font-size: 10px; text-align: center; font-style: italic; border-top: 1px solid #ccc; padding-top: 10px; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div class="brand">${carrier.shortName}</div>
                        <div class="date">${dateStr}</div>
                    </div>
                    
                    <div class="barcode-box">
                        <span class="barcode">${carrierData.trackingCode}</span>
                        <span class="code-label">Mã vận đơn</span>
                    </div>
                    
                    <div class="section">
                        <div class="row">
                            <span class="label">Đơn hàng:</span>
                            <span class="val">#${order.id}</span>
                        </div>
                        <div class="row">
                            <span class="label">Người nhận:</span>
                            <span class="val large">${order.customerName}</span>
                        </div>
                        <div class="row">
                            <span class="label">Điện thoại:</span>
                            <span class="val">${order.customerPhone}</span>
                        </div>
                        <div class="row">
                            <span class="label">Địa chỉ:</span>
                            <span class="val address">${order.address}</span>
                        </div>
                    </div>
                    
                    <hr style="border: 0; border-top: 1px dashed #ccc; margin: 15px 0;">
                    
                    <div class="section">
                        <div class="row">
                            <span class="label">Nội dung:</span>
                            <span class="val">${order.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}</span>
                        </div>
                        <div class="row">
                            <span class="label">Ghi chú:</span>
                            <span class="val">${order.notes || 'Cho xem hàng'}</span>
                        </div>
                        <div class="row">
                            <span class="label">KL:</span>
                            <span class="val">${carrierData.weight}g</span>
                        </div>
                    </div>
                    
                    <div class="money-box">
                        <span class="money-label">Tiền Thu Người Nhận (COD)</span>
                        <span class="money-val">${new Intl.NumberFormat('vi-VN').format(carrierData.cod)}đ</span>
                    </div>
                    
                    <div class="footer">
                        Powered by EcoGo Logistics
                    </div>
                    <script>
                        window.print();
                    </script>
                </body>
            </html>
        `);
        w.document.close();
    }
};
