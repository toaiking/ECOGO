
import * as pdfjsLib from 'pdfjs-dist';
import { Order, PaymentMethod } from '../types';

const WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

if (pdfjs && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
}

export interface ReconciliationResult {
    matchedOrders: Order[];
    totalMatchedAmount: number;
    rawTextPreview: string;
}

export const reconciliationService = {
    /**
     * Trích xuất văn bản từ PDF
     */
    extractTextFromPDF: async (file: File): Promise<string> => {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((item: any) => item.str).join(' ');
                fullText += pageText + '\n';
            }
            return fullText;
        } catch (error) {
            console.error("PDF Parsing Error:", error);
            throw new Error("Không thể đọc file PDF.");
        }
    },

    /**
     * Đối soát trực tiếp từ văn bản thô (Dành cho Copy-Paste nội dung biến động số dư)
     */
    reconcileFromText: (text: string, pendingOrders: Order[]): ReconciliationResult => {
        if (!text) return { matchedOrders: [], totalMatchedAmount: 0, rawTextPreview: '' };
        
        // Chuẩn hóa văn bản: Loại bỏ dấu, chuyển in hoa
        const normalizedText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toUpperCase();
        
        const matchedOrders: Order[] = [];
        let totalMatchedAmount = 0;

        // Tìm tất cả các chuỗi trông giống mã đơn hàng (8 ký tự in hoa/số)
        // Ví dụ: DH ABC12345, ABC12345...
        const orderIdRegex = /[A-Z0-9]{8}/g;
        const foundIds = new Set(normalizedText.match(orderIdRegex) || []);

        for (const order of pendingOrders) {
            if (foundIds.has(order.id.toUpperCase())) {
                matchedOrders.push(order);
                totalMatchedAmount += order.totalPrice;
            }
        }

        return {
            matchedOrders,
            totalMatchedAmount,
            rawTextPreview: text.substring(0, 100) + "..."
        };
    },

    /**
     * Đối soát từ File PDF sao kê
     */
    reconcileOrders: async (file: File, allOrders: Order[]): Promise<ReconciliationResult> => {
        const text = await reconciliationService.extractTextFromPDF(file);
        const pending = allOrders.filter(o => !o.paymentVerified && o.status !== 'CANCELLED' && o.paymentMethod === PaymentMethod.TRANSFER);
        return reconciliationService.reconcileFromText(text, pending);
    }
};
