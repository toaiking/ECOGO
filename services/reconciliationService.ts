
import * as pdfjsLib from 'pdfjs-dist';
import { GoogleGenAI, Type } from "@google/genai";
import { Order, PaymentMethod, ReconciliationResult, BankTransaction } from '../types';

const WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

if (pdfjs && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
}

/**
 * Chuẩn hóa chuỗi: Loại bỏ dấu, chuyển in hoa
 */
const normalize = (str: string): string => {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .toUpperCase();
};

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
                const items = textContent.items as any[];
                
                if (items.length === 0) continue;

                // 1. Sắp xếp tất cả item theo tọa độ Y (giảm dần - từ trên xuống)
                // Nếu Y bằng nhau, sắp xếp theo X (tăng dần - từ trái sang)
                items.sort((a, b) => {
                    const yDiff = b.transform[5] - a.transform[5];
                    if (Math.abs(yDiff) > 5) return yDiff; // Ngưỡng dòng mới
                    return a.transform[4] - b.transform[4];
                });

                // 2. Nhóm các item vào các dòng
                const lines: any[][] = [];
                let currentLine: any[] = [];
                let lastY = -1;

                items.forEach(item => {
                    const y = item.transform[5];
                    if (lastY === -1 || Math.abs(y - lastY) < 5) {
                        currentLine.push(item);
                    } else {
                        lines.push(currentLine);
                        currentLine = [item];
                    }
                    lastY = y;
                });
                if (currentLine.length > 0) lines.push(currentLine);

                // 3. Xử lý từng dòng để giữ cấu trúc cột
                lines.forEach(line => {
                    // Sắp xếp lại X trong dòng cho chắc chắn
                    line.sort((a, b) => a.transform[4] - b.transform[4]);

                    let lineText = '';
                    let lastX = -1;
                    let lastWidth = 0;

                    line.forEach(item => {
                        const x = item.transform[4];
                        const str = item.str;
                        
                        if (lastX !== -1) {
                            const gap = x - (lastX + lastWidth);
                            
                            // Nếu khoảng cách lớn, chèn nhiều khoảng trắng để phân tách cột
                            if (gap > 20) {
                                lineText += '    '; // Cột xa
                            } else if (gap > 5) {
                                lineText += '  ';   // Cột gần
                            } else if (gap > 1) {
                                lineText += ' ';    // Khoảng trắng từ ngữ
                            }
                        }
                        
                        lineText += str;
                        lastX = x;
                        lastWidth = item.width || 0;
                    });

                    if (lineText.trim()) {
                        fullText += lineText + '\n';
                    }
                });
            }
            return fullText;
        } catch (error) {
            console.error("PDF Parsing Error:", error);
            throw new Error("Không thể đọc file PDF.");
        }
    },

    /**
     * Phân tích văn bản sao kê bằng AI (Gemini) để đạt độ chính xác tuyệt đối
     */
    parseWithAI: async (text: string): Promise<{
        account_info: any;
        transactions: BankTransaction[];
        summary: any;
    }> => {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
            
            const prompt = `
            You are an AI that extracts structured data from Vietnamese bank statements (PDF text).
            Task: Extract all information from the statement into a clean JSON format.

            Requirements:
            1. Extract account information: customer_name, account_number, account_type, currency, statement_period (from, to).
            2. Extract all transactions from the table. Each transaction must include:
               - date (YYYY-MM-DD)
               - description (full text, merged if multi-line)
               - transaction_no
               - remitter (the person who sent the money, if available)
               - bank (the sender's bank name, if available)
               - amount (integer, no commas or dots)
               - type ("income" if credit > 0, "expense" if debit > 0)
               - balance (integer)
            3. Rules:
               - Each row = 1 transaction.
               - Merge broken/multi-line rows into one.
               - Ignore summary rows like "Total volume" or "Ending balance".
               - Normalize all numbers (e.g. 1,000,000 -> 1000000).
               - Keep correct transaction order.
               - Currency is VND.
            4. Extract summary: total_debit, total_credit, ending_balance.

            Input Text:
            ${text}

            Output format (strict JSON only):
            {
              "account_info": {
                "customer_name": "string",
                "account_number": "string",
                "account_type": "string",
                "currency": "string",
                "statement_period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
              },
              "transactions": [
                {
                  "date": "YYYY-MM-DD",
                  "description": "string",
                  "transaction_no": "string",
                  "remitter": "string",
                  "bank": "string",
                  "amount": number,
                  "type": "income" | "expense",
                  "balance": number
                }
              ],
              "summary": {
                "total_debit": number,
                "total_credit": number,
                "ending_balance": number
              }
            }
            `;

            const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                }
            });

            const result = JSON.parse(response.text || '{}');
            
            // Map AI transactions to BankTransaction type
            const transactions: BankTransaction[] = (result.transactions || []).map((t: any, index: number) => ({
                id: `ai-tx-${Date.now()}-${index}`,
                date: t.date,
                amount: t.amount,
                description: t.description,
                remitter: t.remitter || '',
                bankName: t.bank || '',
                rawText: t.description, // Use description as raw text for AI results
                isVerified: false
            }));

            return {
                account_info: result.account_info,
                transactions,
                summary: result.summary
            };
        } catch (error) {
            console.error("AI Parsing Error:", error);
            throw new Error("Không thể phân tích dữ liệu bằng AI. Vui lòng thử lại hoặc sử dụng phương pháp thủ công.");
        }
    },

    /**
     * Phân tích văn bản sao kê thành danh sách giao dịch
     */
    parseBankStatement: (text: string): BankTransaction[] => {
        const transactions: BankTransaction[] = [];
        const lines = text.split('\n');

        // Regex tìm số tiền (ví dụ: 1.000.000, 1,000,000, 1000000)
        const amountRegex = /([+-]?\s*\d{1,3}(?:[.,]\d{3})*(?:\.\d+)?)(?!\d)/g;
        // Regex tìm ngày tháng (DD/MM/YYYY hoặc DD-MM-YYYY)
        const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;

        // Thử tìm dòng tiêu đề để xác định vị trí cột
        let headerIdxs = { date: -1, remitter: -1, bank: -1, desc: -1, credit: -1, balance: -1 };
        
        for (const line of lines) {
            const normalized = normalize(line);
            if (normalized.includes('NGAY GIAO DICH') || normalized.includes('NGAY GD') || normalized.includes('DIEN GIAI')) {
                // Tách cột bằng ít nhất 2 khoảng trắng
                const cols = line.split(/\s{2,}/).map(c => normalize(c.trim()));
                headerIdxs.date = cols.findIndex(c => c.includes('NGAY'));
                headerIdxs.remitter = cols.findIndex(c => c.includes('DOI TAC') || c.includes('REMITTER'));
                headerIdxs.bank = cols.findIndex(c => c.includes('NH DOI TAC') || c.includes('BANK'));
                headerIdxs.desc = cols.findIndex(c => c.includes('DIEN GIAI') || c.includes('NOI DUNG') || c.includes('DETAILS'));
                headerIdxs.credit = cols.findIndex(c => c.includes('CO TKTT') || c.includes('SO TIEN CO') || c.includes('CREDIT'));
                headerIdxs.balance = cols.findIndex(c => c.includes('SO DU') || c.includes('BALANCE'));
                break;
            }
        }

        lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return;

            const dateMatch = trimmedLine.match(dateRegex);
            const amounts = trimmedLine.match(amountRegex);

            // Một dòng giao dịch hợp lệ thường có ngày tháng
            if (dateMatch) {
                const cleanAmount = (amt: string) => {
                    const cleaned = amt.replace(/\s/g, '').replace(/[.,](\d{3})/g, '$1').replace(',', '.');
                    return parseFloat(cleaned);
                };

                // Lấy tất cả các số có vẻ là số tiền
                const amountValues = (amounts || [])
                    .map(cleanAmount)
                    .filter(v => !isNaN(v) && v !== 0 && Math.abs(v) < 1000000000);

                // Tách cột bằng ít nhất 2 khoảng trắng
                const columns = trimmedLine.split(/\s{2,}/).filter(c => c.trim().length > 0);
                
                let amount = 0;
                let description = trimmedLine;
                let remitter = '';
                let bankName = '';

                // 1. Thử lấy theo header nếu có
                if (headerIdxs.credit !== -1 && columns.length > headerIdxs.credit) {
                    const creditVal = cleanAmount(columns[headerIdxs.credit]);
                    if (!isNaN(creditVal) && creditVal !== 0) {
                        amount = creditVal;
                    }
                }

                // 2. Nếu không có header hoặc không lấy được, dùng heuristic cho Techcombank/Vietcombank
                if (amount === 0 && amountValues.length > 0) {
                    if (amountValues.length >= 2) {
                        // Trong bảng sao kê, số áp chót thường là số tiền giao dịch (Có/Nợ)
                        // Số cuối cùng là Số dư
                        amount = amountValues[amountValues.length - 2];
                    } else {
                        amount = amountValues[0];
                    }
                }

                // 3. Trích xuất thông tin khác
                if (columns.length >= 3) {
                    const dateColIdx = columns.findIndex(c => dateRegex.test(c));
                    if (dateColIdx !== -1) {
                        // Remitter thường ở cột tiếp theo sau ngày
                        const rIdx = headerIdxs.remitter !== -1 ? headerIdxs.remitter : dateColIdx + 1;
                        const bIdx = headerIdxs.bank !== -1 ? headerIdxs.bank : dateColIdx + 2;
                        const dIdx = headerIdxs.desc !== -1 ? headerIdxs.desc : (columns.length > 4 ? dateColIdx + 3 : dateColIdx + 1);

                        remitter = columns[rIdx] || '';
                        bankName = columns[bIdx] || '';
                        description = columns[dIdx] || trimmedLine;
                        
                        // Nếu description quá ngắn, có thể nó bị tách ra, lấy cột dài nhất làm description
                        if (description.length < 5) {
                            const longestCol = [...columns].sort((a, b) => b.length - a.length)[0];
                            if (longestCol && longestCol.length > description.length) {
                                description = longestCol;
                            }
                        }
                    }
                }

                if (amount !== 0) {
                    transactions.push({
                        id: `tx-${Date.now()}-${index}`,
                        date: dateMatch[0],
                        amount: Math.abs(amount), // Lấy giá trị tuyệt đối cho số tiền giao dịch
                        description: description.trim(),
                        remitter: remitter.trim(),
                        bankName: bankName.trim(),
                        rawText: trimmedLine,
                        isVerified: false
                    });
                }
            }
        });

        return transactions;
    },

    /**
     * Gợi ý các đơn hàng khớp cho danh sách giao dịch
     */
    suggestMatches: (
        transactions: BankTransaction[],
        pendingOrders: Order[]
    ): BankTransaction[] => {
        return transactions.map(tx => {
            const normalizedDesc = normalize(tx.description);

            // 1. Khớp theo Mã đơn hàng (Độ tin cậy CAO)
            const orderIdMatch = pendingOrders.find(order =>
                normalizedDesc.includes(normalize(order.id))
            );

            if (orderIdMatch) {
                return {
                    ...tx,
                    suggestedOrderId: orderIdMatch.id,
                    matchConfidence: 'HIGH'
                };
            }

            // 2. Khớp theo Số tiền (Độ tin cậy TRUNG BÌNH)
            const amountMatches = pendingOrders.filter(order =>
                Math.abs(order.totalPrice - tx.amount) < 1
            );

            if (amountMatches.length === 1) {
                return {
                    ...tx,
                    suggestedOrderId: amountMatches[0].id,
                    matchConfidence: 'MEDIUM'
                };
            }

            // 3. Khớp theo Tên khách hàng + Số tiền (Độ tin cậy TRUNG BÌNH)
            const nameAndAmountMatch = pendingOrders.find(order =>
                normalizedDesc.includes(normalize(order.customerName)) &&
                Math.abs(order.totalPrice - tx.amount) < 1
            );

            if (nameAndAmountMatch) {
                return {
                    ...tx,
                    suggestedOrderId: nameAndAmountMatch.id,
                    matchConfidence: 'MEDIUM'
                };
            }

            return tx;
        });
    },

    /**
     * Đối soát trực tiếp từ văn bản thô (Dành cho Copy-Paste nội dung biến động số dư)
     */
    reconcileFromText: (text: string, pendingOrders: Order[]): ReconciliationResult => {
        if (!text) return { matchedOrders: [], totalMatchedAmount: 0, rawTextPreview: '' };
        
        // Sử dụng parseBankStatement để bóc tách các giao dịch có cấu trúc
        const parsedTxs = reconciliationService.parseBankStatement(text);
        
        // Nếu không bóc tách được giao dịch nào theo cấu trúc (ví dụ: chỉ là 1 đoạn text ngắn)
        // thì quay lại logic tìm kiếm ID đơn hàng thô
        if (parsedTxs.length === 0) {
            const normalizedText = normalize(text);
            const matchedOrders: Order[] = [];
            let totalMatchedAmount = 0;

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
        }

        // Nếu bóc tách được giao dịch, sử dụng logic suggestMatches để khớp chính xác hơn
        const withMatches = reconciliationService.suggestMatches(parsedTxs, pendingOrders);
        const matchedOrderIds = new Set(
            withMatches
                .filter(tx => tx.suggestedOrderId)
                .map(tx => tx.suggestedOrderId)
        );

        const matchedOrders = pendingOrders.filter(o => matchedOrderIds.has(o.id));
        const totalMatchedAmount = matchedOrders.reduce((sum, o) => sum + o.totalPrice, 0);

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
        const pending = allOrders.filter((o: Order) => !o.paymentVerified && o.status !== 'CANCELLED' && o.paymentMethod === PaymentMethod.TRANSFER);
        
        // Sử dụng parseBankStatement và suggestMatches để đối soát chính xác theo dòng
        const parsedTxs = reconciliationService.parseBankStatement(text);
        const withMatches = reconciliationService.suggestMatches(parsedTxs, pending);
        
        const matchedOrderIds = new Set(
            withMatches
                .filter(tx => tx.suggestedOrderId)
                .map(tx => tx.suggestedOrderId)
        );

        const matchedOrders = pending.filter(o => matchedOrderIds.has(o.id));
        const totalMatchedAmount = matchedOrders.reduce((sum, o) => sum + o.totalPrice, 0);

        return {
            matchedOrders,
            totalMatchedAmount,
            rawTextPreview: text.substring(0, 100) + "..."
        };
    }
};
