import compose from 'koa-compose';

type TTask<T extends Record<string, any>> = (ctx: T, next: () => any) => void;
export default class PromiseFlow<T extends Record<string, any> = Record<string, any>> {
  private _tasks: TTask<T>[] = [];
  _context: T = {} as any;
  requestedApproval = false;

  use(fn: TTask<T>): PromiseFlow<T> {
    if (typeof fn !== 'function') {
      throw new Error('promise need function to handle');
    }
    this._tasks.push(fn);

    return this;
  }

  callback() {
    return compose(this._tasks);
  }
}
