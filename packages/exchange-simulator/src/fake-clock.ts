/**
 * FakeClock - 可控时间，用于测试
 * 
 * 解决问题：退避重试、holdingHours 等时间相关逻辑需要可控的时间源
 */

export class FakeClock {
    private currentTime: number;

    constructor(initialTime: number | Date = Date.now()) {
        this.currentTime = typeof initialTime === 'number'
            ? initialTime
            : initialTime.getTime();
    }

    /**
     * 获取当前时间戳（毫秒）
     */
    now(): number {
        return this.currentTime;
    }

    /**
     * 获取当前时间 ISO 字符串
     */
    nowISO(): string {
        return new Date(this.currentTime).toISOString();
    }

    /**
     * 推进时间
     * @param ms 毫秒数
     */
    advance(ms: number): void {
        if (ms < 0) {
            throw new Error('Cannot advance time backwards');
        }
        this.currentTime += ms;
    }

    /**
     * 设置时间到指定时刻
     * @param timestamp 时间戳或 Date 对象
     */
    setTime(timestamp: number | Date): void {
        this.currentTime = typeof timestamp === 'number'
            ? timestamp
            : timestamp.getTime();
    }

    /**
     * 重置到初始状态（可选指定时间）
     */
    reset(timestamp?: number | Date): void {
        if (timestamp !== undefined) {
            this.setTime(timestamp);
        } else {
            this.currentTime = Date.now();
        }
    }

    /**
     * 创建一个 sleep 函数的模拟（立即返回但推进时间）
     */
    createSleep(): (ms: number) => Promise<void> {
        return async (ms: number): Promise<void> => {
            this.advance(ms);
        };
    }
}
