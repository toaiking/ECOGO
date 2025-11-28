
import * as pdfjsLib from 'pdfjs-dist';
import { Order, PaymentMethod } from '../types';

// Fix: Use cdnjs for the worker script. 
// esm.sh workers often fail with CORS or MIME type errors in browser environments.
const WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Handle ESM default export mismatch (common with CDN imports of pdfjs-dist)
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

if (pdfjs && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
} else {
    console.warn("PDF.js GlobalWorkerOptions not found. PDF parsing might fail.");
}

export interface ReconciliationResult {
    matchedOrders: Order[];
    totalMatchedAmount: number;
    rawTextPreview: string;
}

export const reconciliationService = {
    /**
     * Extracts text from a PDF file.
     */
    extractTextFromPDF: async (file: File): Promise<string> => {
        try {
            const arrayBuffer = await file.arrayBuffer();
            
            // Use the resolved pdfjs object (with fallback)
            const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            
            let fullText = '';
            
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                
                // Join items with space, add newline at end of page
                const pageText = textContent.items
                    .map((item: any) => item.str)
                    .join(' ');
                
                fullText += pageText + '\n';
            }
            
            return fullText;
        } catch (error) {
            console.error("PDF Parsing Error:", error);
            throw new Error("Không thể đọc file PDF. Vui lòng đảm bảo file không bị hỏng.");
        }
    },

    /**
     * Matches orders against the extracted PDF text.
     * Strategy: Look for the specific Order ID in the text.
     */
    reconcileOrders: async (file: File, allOrders: Order[]): Promise<ReconciliationResult> => {
        // 1. Get Text from PDF
        const text = await reconciliationService.extractTextFromPDF(file);
        
        // 2. Filter orders that need checking:
        //    - PaymentMethod is TRANSFER (or CASH if we want to catch mistakes)
        //    - Not yet verified
        //    - Not Cancelled
        const pendingOrders = allOrders.filter(o => 
            !o.paymentVerified && 
            o.status !== 'CANCELLED' && 
            (o.paymentMethod === PaymentMethod.TRANSFER || o.paymentMethod === PaymentMethod.CASH)
        );

        const matchedOrders: Order[] = [];
        let totalMatchedAmount = 0;

        // 3. Scan text for each Order ID
        // Note: Order IDs are unique enough (8 chars uppercase) that collision is very rare.
        // We look for the ID. If found, we assume it's the transaction.
        
        // Normalize text for search (remove accents, uppercase)
        const normalizedText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

        for (const order of pendingOrders) {
            // Our QR code generates content like "DH <ID>" or just "DH<ID>"
            // But bank descriptions might cut spaces.
            // So we search for the raw ID.
            const orderId = order.id.toUpperCase();
            
            if (normalizedText.includes(orderId)) {
                matchedOrders.push(order);
                totalMatchedAmount += order.totalPrice;
            }
        }

        return {
            matchedOrders,
            totalMatchedAmount,
            rawTextPreview: text.substring(0, 500) + "..." // Preview first 500 chars
        };
    }
};
