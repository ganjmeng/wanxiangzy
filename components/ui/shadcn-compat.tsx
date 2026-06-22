"use client";

import Link from "next/link";
import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { toast } from "sonner";
import { ArrowRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton as ShadcnSkeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type PrimitiveValue = string | number | boolean | null | undefined;

export type ColumnType<T> = {
  key?: string;
  title: ReactNode;
  dataIndex?: keyof T | string;
  width?: number | string;
  align?: "left" | "center" | "right";
  fixed?: "left" | "right" | boolean;
  className?: string;
  ellipsis?: boolean | { tooltip?: ReactNode };
  render?: (value: any, record: T, index: number) => ReactNode;
  sorter?: (a: T, b: T) => number;
  filters?: Array<{ text: ReactNode; value: PrimitiveValue }>;
  onFilter?: (value: PrimitiveValue, record: T) => boolean;
};

export type ColumnsType<T> = ColumnType<T>[];

type Option = {
  value: string | number;
  label: ReactNode;
  disabled?: boolean;
  [key: string]: any;
};

function getValue(record: any, dataIndex?: keyof any | string) {
  if (!dataIndex) return undefined;
  return String(dataIndex)
    .split(".")
    .reduce((value, key) => (value == null ? undefined : value[key]), record);
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return "";
}

export function ConfigProvider({
  children,
}: {
  children: ReactNode;
  locale?: unknown;
  theme?: unknown;
  getPopupContainer?: (triggerNode?: HTMLElement) => HTMLElement;
}) {
  return <>{children}</>;
}

export const zhCN = {};

export const theme = {
  compactAlgorithm: {},
};

type ConfirmOptions = {
  title?: ReactNode;
  content?: ReactNode;
  okText?: ReactNode;
  cancelText?: ReactNode;
  okButtonProps?: { danger?: boolean; disabled?: boolean };
  onOk?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
};

type AppApi = {
  message: {
    success: (message: ReactNode) => void;
    error: (message: ReactNode) => void;
    warning: (message: ReactNode) => void;
    info: (message: ReactNode) => void;
  };
  modal: {
    confirm: (options: ConfirmOptions) => Promise<void>;
  };
};

type ConfirmState = ConfirmOptions & { id: number };

const AppContext = createContext<AppApi | null>(null);

const fallbackAppApi: AppApi = {
  message: {
    success: (message: ReactNode) => toast.success(textFromNode(message)),
    error: (message: ReactNode) => toast.error(textFromNode(message)),
    warning: (message: ReactNode) => toast.warning(textFromNode(message)),
    info: (message: ReactNode) => toast.info(textFromNode(message)),
  },
  modal: {
    confirm: async () => {
      toast.error("确认弹窗未初始化，操作未执行");
    },
  },
};

function useApp() {
  return useContext(AppContext) || fallbackAppApi;
}

export const App = Object.assign(function App({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  const appApi = useMemo<AppApi>(() => ({
    message: fallbackAppApi.message,
    modal: {
      confirm: async (options) => {
        setConfirmState({ ...options, id: Date.now() });
      },
    },
  }), []);

  async function closeConfirm(runCancel: boolean) {
    const current = confirmState;
    setConfirmState(null);
    if (runCancel) {
      try {
        await current?.onCancel?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "操作失败");
      }
    }
  }

  async function confirmOk(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const current = confirmState;
    if (!current || current.okButtonProps?.disabled) return;
    setConfirmSubmitting(true);
    try {
      await current.onOk?.();
      setConfirmState(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setConfirmSubmitting(false);
    }
  }

  return (
    <AppContext.Provider value={appApi}>
      {children}
      <AlertDialog
        open={Boolean(confirmState)}
        onOpenChange={(open) => {
          if (!open) void closeConfirm(true);
        }}
      >
        <AlertDialogContent key={confirmState?.id}>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title || "确认操作"}</AlertDialogTitle>
            {confirmState?.content ? (
              <AlertDialogDescription className="whitespace-pre-line">
                {confirmState.content}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmSubmitting}>
              {confirmState?.cancelText || "取消"}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={confirmState?.okButtonProps?.danger ? "destructive" : "default"}
              disabled={confirmSubmitting || confirmState?.okButtonProps?.disabled}
              onClick={confirmOk}
            >
              {confirmState?.okText || "确认"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppContext.Provider>
  );
}, { useApp });

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  type?: "default" | "primary" | "text" | "link";
  htmlType?: React.ButtonHTMLAttributes<HTMLButtonElement>["type"];
  danger?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  size?: "small" | "middle" | "large";
  block?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, type = "default", htmlType = "button", danger, loading, icon, size = "middle", block, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={htmlType}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        size === "small" ? "h-8 px-2.5 text-xs" : size === "large" ? "h-11 px-5" : "h-9 px-4",
        type === "primary" && !danger && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        danger && "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
        type === "default" && !danger && "border-border bg-white text-slate-900 hover:bg-slate-50",
        type === "text" && "border-transparent bg-transparent hover:bg-slate-100",
        type === "link" && "h-auto border-transparent bg-transparent p-0 text-primary underline-offset-4 hover:underline",
        block && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon ? <span className="inline-flex h-4 w-4 items-center justify-center">{icon}</span> : null}
      {children}
    </button>
  );
});

type CardProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title?: ReactNode;
  extra?: ReactNode;
  loading?: boolean;
  styles?: { body?: CSSProperties; header?: CSSProperties };
};

export function Card({ title, extra, loading, className, styles, children, ...props }: CardProps) {
  return (
    <section className={cn("rounded-lg border border-border bg-card text-card-foreground shadow-sm", className)} {...props}>
      {(title || extra) && (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-3" style={styles?.header}>
          <div className="min-w-0 text-sm font-semibold text-slate-950">{title}</div>
          {extra ? <div className="shrink-0">{extra}</div> : null}
        </div>
      )}
      <div className="p-4" style={styles?.body}>
        {loading ? <CardLoadingSkeleton /> : children}
      </div>
    </section>
  );
}

function CardLoadingSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex items-center gap-3">
        <ShadcnSkeleton className="h-10 w-10 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <ShadcnSkeleton className="h-4 w-40 max-w-full" />
          <ShadcnSkeleton className="h-3 w-64 max-w-[80%]" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <ShadcnSkeleton key={index} className="h-16 rounded-md" />
        ))}
      </div>
      <ShadcnSkeleton className="h-36 rounded-md" />
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  allowClear?: boolean;
  prefix?: ReactNode;
};

const BaseInput = forwardRef<HTMLInputElement, InputProps>(function BaseInput({ className, prefix, allowClear, ...props }, ref) {
  if (prefix) {
    return (
      <span className={cn("flex h-9 items-center gap-2 rounded-md border border-input bg-white px-3 text-sm shadow-sm focus-within:ring-2 focus-within:ring-ring", className)}>
        <span className="text-slate-400">{prefix}</span>
        <input ref={ref} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400" {...props} />
      </span>
    );
  }

  return (
    <input
      ref={ref}
      className={cn("h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
});

function TextArea({ className, showCount, maxLength, value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { showCount?: boolean }) {
  const length = typeof value === "string" ? value.length : typeof props.defaultValue === "string" ? props.defaultValue.length : 0;
  return (
    <span className="block">
      <textarea
        className={cn("min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className)}
        maxLength={maxLength}
        value={value}
        {...props}
      />
      {showCount && maxLength ? <span className="mt-1 block text-right text-xs text-slate-400">{length} / {maxLength}</span> : null}
    </span>
  );
}

function SearchInput({
  enterButton,
  onSearch,
  ...props
}: InputProps & { enterButton?: ReactNode; onSearch?: (value: string) => void }) {
  const [value, setValue] = useState(String(props.defaultValue ?? props.value ?? ""));
  return (
    <span className="flex gap-2">
      <BaseInput
        {...props}
        value={props.value ?? value}
        onChange={(event) => {
          setValue(event.target.value);
          props.onChange?.(event);
        }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (event.key === "Enter") onSearch?.((event.currentTarget as HTMLInputElement).value);
        }}
      />
      {enterButton ? <Button htmlType="button" type="primary" onClick={() => onSearch?.(value)}>{enterButton === true ? "查询" : enterButton}</Button> : null}
    </span>
  );
}

export const Input = Object.assign(BaseInput, { TextArea, Search: SearchInput });

export function InputNumber(props: InputProps & { min?: number; max?: number }) {
  return <BaseInput type="number" {...props} />;
}

type SelectProps = {
  options?: Option[];
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: any, option?: any) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  filterOption?: boolean;
  optionRender?: (option: { data: Option }) => ReactNode;
  showSearch?: boolean;
  allowClear?: boolean;
  loading?: boolean;
  placeholder?: string;
  notFoundContent?: ReactNode;
  className?: string;
  disabled?: boolean;
  popupMatchSelectWidth?: boolean | number;
  getPopupContainer?: unknown;
  style?: CSSProperties;
  name?: string;
};

export function Select({
  options = [],
  value,
  defaultValue,
  onChange,
  onSearch,
  onClear,
  optionRender,
  showSearch,
  allowClear,
  loading,
  placeholder,
  notFoundContent,
  className,
  disabled,
  style,
  name,
}: SelectProps) {
  const controlled = value !== undefined;
  const [innerValue, setInnerValue] = useState<string | number | undefined>(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const currentValue = controlled ? value : innerValue;
  const selected = options.find((item) => String(item.value) === String(currentValue));
  const visibleOptions = showSearch && query
    ? options.filter((item) => textFromNode(item.label).toLowerCase().includes(query.toLowerCase()) || String(item.value).toLowerCase().includes(query.toLowerCase()))
    : options;

  function commit(option: Option | undefined) {
    const next = option?.value ?? "";
    if (!controlled) setInnerValue(next);
    setQuery("");
    setOpen(false);
    onChange?.(next, option);
  }

  if (!showSearch) {
    const currentValueString = currentValue === undefined || currentValue === null ? "" : String(currentValue);

    return (
      <span className={cn("inline-block w-full", className)} style={style}>
        {name ? <input type="hidden" name={name} value={currentValueString} /> : null}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={placeholder}
              className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-white px-3 text-left text-sm shadow-sm outline-none transition-colors hover:bg-slate-50 focus:border-ring focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className={cn("min-w-0 flex-1 truncate", !selected && "text-slate-400")}>
                {selected?.label ?? placeholder ?? ""}
              </span>
              {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={4}
            role="listbox"
            className="z-[5000] max-h-[min(320px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)] gap-0 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg"
          >
            {options.map((option) => (
              <SelectOptionButton
                key={String(option.value)}
                option={option}
                selected={String(option.value) === currentValueString}
                onSelect={commit}
                optionRender={optionRender}
              />
            ))}
            {!options.length ? <div className="px-3 py-2 text-sm text-slate-500">{notFoundContent ?? "暂无数据"}</div> : null}
          </PopoverContent>
        </Popover>
      </span>
    );
  }

  return (
    <div className={cn("relative w-full", className)} style={style}>
      <div className="flex h-10 items-center rounded-md border border-input bg-white px-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <input
          name={name}
          disabled={disabled}
          value={open ? query : textFromNode(selected?.label) || ""}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            onSearch?.(event.target.value);
          }}
        />
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
        {allowClear && currentValue ? (
          <button type="button" className="ml-1 text-slate-400 hover:text-slate-700" onClick={() => { commit(undefined); onClear?.(); }}>
            <X className="h-4 w-4" />
          </button>
        ) : null}
        <button type="button" className="ml-1 text-slate-400" onClick={() => setOpen((next) => !next)}>
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+4px)] z-[5000] max-h-64 w-full overflow-auto rounded-md border border-border bg-white p-1 text-sm shadow-xl">
          {visibleOptions.length ? visibleOptions.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              disabled={option.disabled}
              className="flex w-full items-start justify-between gap-3 rounded-sm px-2 py-2 text-left hover:bg-slate-100 disabled:opacity-50"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(option)}
            >
              <span className="min-w-0">{optionRender ? optionRender({ data: option }) : option.label}</span>
              {String(option.value) === String(currentValue) ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : null}
            </button>
          )) : (
            <div className="px-2 py-3 text-center text-slate-500">{notFoundContent || "暂无数据"}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SelectOptionButton({
  option,
  selected,
  onSelect,
  optionRender,
}: {
  option: Option;
  selected: boolean;
  onSelect: (option: Option) => void;
  optionRender?: (option: { data: Option }) => ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={option.disabled}
      onClick={() => onSelect(option)}
      className={cn(
        "relative flex min-h-8 w-full items-center rounded-sm px-3 py-1.5 pr-8 text-left text-sm outline-none transition-colors disabled:pointer-events-none disabled:opacity-50",
        selected ? "bg-zinc-900 text-white" : "text-slate-900 hover:bg-slate-50 focus:bg-slate-50"
      )}
    >
      <span className="min-w-0 flex-1 truncate">{optionRender ? optionRender({ data: option }) : option.label}</span>
      {selected ? <Check className="absolute right-2 h-4 w-4" /> : null}
    </button>
  );
}

type FormInstance<T extends Record<string, any> = Record<string, any>> = {
  submit: () => void;
  resetFields: () => void;
  setFieldValue: (name: keyof T | string, value: any) => void;
  setFieldsValue: (values: Partial<T>) => void;
  getFieldsValue: () => Partial<T>;
  __wire?: (api: Partial<FormInstance<T>>) => void;
};

function createFormInstance<T extends Record<string, any>>(): FormInstance<T> {
  const instance: FormInstance<T> = {
    submit: () => undefined,
    resetFields: () => undefined,
    setFieldValue: () => undefined,
    setFieldsValue: () => undefined,
    getFieldsValue: () => ({}),
    __wire(api) {
      Object.assign(instance, api);
    },
  };
  return instance;
}

const FormContext = createContext<{
  values: Record<string, any>;
  setValue: (name: string, value: any) => void;
} | null>(null);

function FormRoot<T extends Record<string, any> = Record<string, any>>({
  form,
  initialValues,
  onFinish,
  className,
  children,
  ...props
}: Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  form?: FormInstance<T>;
  initialValues?: Partial<T>;
  layout?: "vertical" | "inline";
  onFinish?: (values: T) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, any>>(() => ({ ...(initialValues || {}) }));
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const submit = async () => {
    await onFinish?.(valuesRef.current as T);
  };

  useEffect(() => {
    form?.__wire?.({
      submit,
      resetFields: () => setValues({ ...(initialValues || {}) }),
      setFieldValue: (name, value) => setValues((current) => ({ ...current, [String(name)]: value })),
      setFieldsValue: (nextValues) => setValues((current) => ({ ...current, ...nextValues })),
      getFieldsValue: () => valuesRef.current as Partial<T>,
    });
  });

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      {...props}
    >
      <FormContext.Provider value={{ values, setValue: (name, value) => setValues((current) => ({ ...current, [name]: value })) }}>
        {children}
      </FormContext.Provider>
    </form>
  );
}

function FormItem({
  name,
  label,
  children,
  className,
  noStyle,
  extra,
}: {
  name?: string;
  label?: ReactNode;
  children?: ReactNode;
  className?: string;
  noStyle?: boolean;
  rules?: unknown;
  valuePropName?: string;
  extra?: ReactNode;
}) {
  const ctx = useContext(FormContext);
  const child = Children.only(children) as ReactElement<any>;
  const injected = name && ctx && isValidElement<any>(child)
    ? cloneElement(child, {
        value: ctx.values[name] ?? child.props.value,
        checked: child.props.checked ?? ctx.values[name],
        onChange: (...args: any[]) => {
          const first = args[0];
          const nextValue = first?.target
            ? (first.target.type === "checkbox" ? first.target.checked : first.target.value)
            : first;
          ctx.setValue(name, nextValue);
          child.props.onChange?.(...args);
        },
      })
    : child;

  if (noStyle) return injected;

  return (
    <label className={cn("mb-3 block", className)}>
      {label ? <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span> : null}
      {injected}
      {extra ? <span className="mt-1 block text-xs text-slate-500">{extra}</span> : null}
    </label>
  );
}

function useForm<T extends Record<string, any>>() {
  const ref = useRef<FormInstance<T> | null>(null);
  if (!ref.current) ref.current = createFormInstance<T>();
  return [ref.current] as const;
}

export const Form = Object.assign(FormRoot, { Item: FormItem, useForm });

function RadioItem({ value, children, checked, onChange }: { value: string; children?: ReactNode; checked?: boolean; onChange?: (event: any) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm hover:bg-slate-50">
      <input type="radio" className="mt-1" value={value} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

function RadioGroup({ value, onChange, children, className }: { value?: string; onChange?: (value: string) => void; children?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {Children.map(children, (child) => {
        if (!isValidElement<any>(child)) return child;
        const option = child as ReactElement<any>;
        return cloneElement(option, {
          checked: String(option.props.value) === String(value),
          onChange: () => onChange?.(option.props.value),
        });
      })}
    </div>
  );
}

export const Radio = Object.assign(RadioItem, { Group: RadioGroup });

export function Checkbox({ checked, onChange, children, className, name, value }: { checked?: boolean; onChange?: (event: any) => void; children?: ReactNode; className?: string; name?: string; value?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input
        name={name}
        value={value}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange?.(event)}
        className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
      />
      {children}
    </label>
  );
}

export function Switch({ checked, onChange, checkedChildren, unCheckedChildren }: { checked?: boolean; onChange?: (checked: boolean) => void; checkedChildren?: ReactNode; unCheckedChildren?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={Boolean(checked)}
      onClick={() => onChange?.(!checked)}
      className={cn("inline-flex h-7 min-w-14 items-center rounded-full border px-1 text-xs font-medium transition", checked ? "border-primary bg-primary text-white" : "border-border bg-slate-100 text-slate-500")}
    >
      <span className={cn("h-5 w-5 rounded-full bg-white shadow transition", checked ? "translate-x-7" : "translate-x-0")} />
      <span className="ml-2 mr-1">{checked ? checkedChildren : unCheckedChildren}</span>
    </button>
  );
}

export function Modal({ title, open, onCancel, onOk, okText = "确认", confirmLoading, okButtonProps, width, children }: { title?: ReactNode; open?: boolean; onCancel?: () => void; onOk?: () => void; okText?: ReactNode; confirmLoading?: boolean; okButtonProps?: { danger?: boolean }; width?: number | string; destroyOnHidden?: boolean; children?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-white shadow-2xl" style={width ? { maxWidth: width } : undefined}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onCancel} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" danger={okButtonProps?.danger} loading={confirmLoading} onClick={onOk}>{okText}</Button>
        </div>
      </div>
    </div>
  );
}

export function Alert({ type = "info", message, description, className }: { type?: "success" | "info" | "warning" | "error"; showIcon?: boolean; message?: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm", type === "error" && "border-red-200 bg-red-50 text-red-800", type === "warning" && "border-amber-200 bg-amber-50 text-amber-900", type === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800", type === "info" && "border-zinc-200 bg-zinc-50 text-zinc-900", className)}>
      {message ? <div className="font-semibold">{message}</div> : null}
      {description ? <div className="mt-1 text-sm opacity-85">{description}</div> : null}
    </div>
  );
}

export function Tag({ color, className, children }: { color?: string; className?: string; children?: ReactNode }) {
  const tone = color === "red" || color === "volcano"
    ? "border-red-200 bg-red-50 text-red-700"
    : color === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : color === "orange" || color === "gold"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : color === "blue"
          ? "border-zinc-200 bg-zinc-100 text-zinc-800"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", tone, className)}>{children}</span>;
}

export function Badge(props: Parameters<typeof Tag>[0]) {
  return <Tag {...props} />;
}

export function Empty({ description }: { image?: ReactNode; description?: ReactNode }) {
  return <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-slate-50 p-6 text-sm text-slate-500">{description || "暂无数据"}</div>;
}
Empty.PRESENTED_IMAGE_SIMPLE = null;

export function Progress({ percent = 0 }: { percent?: number; size?: "small" | "default" }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="w-10 text-right text-xs text-slate-500">{value}%</span>
    </div>
  );
}

export function Statistic({ title, value, suffix, precision, styles }: { title?: ReactNode; value?: number | string; suffix?: ReactNode; precision?: number; styles?: { content?: CSSProperties } }) {
  const display = typeof value === "number" && precision != null ? value.toFixed(precision) : value;
  return (
    <div>
      {title ? <div className="text-xs font-medium text-slate-500">{title}</div> : null}
      <div className="mt-1 text-2xl font-semibold text-slate-950" style={styles?.content}>{display}{suffix}</div>
    </div>
  );
}

export function Space({ orientation, direction, size = 8, wrap, align, className, children }: { orientation?: "vertical" | "horizontal"; direction?: "vertical" | "horizontal"; size?: number | string; wrap?: boolean; align?: "start" | "center" | "end"; className?: string; children?: ReactNode }) {
  const vertical = orientation === "vertical" || direction === "vertical";
  const gap = typeof size === "number" ? `${size}px` : Array.isArray(size) ? undefined : size;
  return (
    <div
      className={cn("flex", vertical ? "flex-col" : "flex-row", wrap && "flex-wrap", align === "start" && "items-start", align === "center" && "items-center", align === "end" && "items-end", !align && !vertical && "items-center", className)}
      style={{ gap }}
    >
      {children}
    </div>
  );
}

export function Table<T extends Record<string, any>>({ columns = [], dataSource = [], rowKey, loading, scroll, pagination, locale, className }: { size?: "small" | "middle"; rowKey?: keyof T | ((row: T) => string); columns?: ColumnsType<T>; dataSource?: T[]; loading?: boolean; tableLayout?: CSSProperties["tableLayout"]; scroll?: { x?: number | string }; pagination?: false | { current?: number; pageSize?: number; total?: number; pageSizeOptions?: Array<number | string>; showSizeChanger?: boolean; showTotal?: (total: number, range: [number, number]) => ReactNode; onChange?: (page: number, pageSize: number) => void }; locale?: { emptyText?: ReactNode }; className?: string }) {
  const paging = pagination === false ? undefined : pagination;
  const total = paging ? paging.total ?? dataSource.length : dataSource.length;
  const page = paging ? paging.current ?? 1 : 1;
  const pageSize = paging ? paging.pageSize ?? dataSource.length : dataSource.length;
  const range: [number, number] = dataSource.length ? [(page - 1) * pageSize + 1, (page - 1) * pageSize + dataSource.length] : [0, 0];
  const pageCount = paging ? Math.max(1, Math.ceil(total / Math.max(1, pageSize))) : 1;
  const pageTokens = paging ? buildPageTokens(page, pageCount) : [];
  const isLastPage = page >= pageCount || range[1] >= total;
  const loadingRows = Math.max(3, Math.min(8, pageSize || 6));
  const safeColumns = columns.length ? columns : [{ title: "", dataIndex: undefined }];

  return (
    <div className={cn("space-y-3", className)}>
      <div className="overflow-auto rounded-md border border-border" style={{ maxWidth: "100%" }}>
        <table className="w-full caption-bottom text-sm" style={{ minWidth: scroll?.x }}>
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column, index) => (
                <th key={index} className={cn("border-b border-border px-3 py-2 text-left font-semibold text-slate-700", column.align === "center" && "text-center", column.align === "right" && "text-right")} style={{ width: column.width }}>
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: loadingRows }).map((_, rowIndex) => (
                <tr key={`loading-${rowIndex}`} className="border-b border-border last:border-0">
                  {safeColumns.map((column, columnIndex) => (
                    <td key={columnIndex} className="px-3 py-3" style={{ width: column.width }}>
                      <ShadcnSkeleton
                        className={cn(
                          "h-4 rounded-md",
                          columnIndex === 0 ? "w-28" : columnIndex % 3 === 0 ? "w-16" : columnIndex % 3 === 1 ? "w-24" : "w-20",
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : dataSource.length ? dataSource.map((row, rowIndex) => {
              const key = typeof rowKey === "function" ? rowKey(row) : rowKey ? String(row[rowKey]) : String(rowIndex);
              return (
                <tr key={key} className="border-b border-border last:border-0 hover:bg-slate-50/70">
                  {columns.map((column, columnIndex) => {
                    const value = getValue(row, column.dataIndex);
                    const isNumeric = typeof value === "number";
                    return (
                      <td key={columnIndex} className={cn("px-3 py-2 align-top", column.align === "center" && "text-center", column.align === "right" && "text-right", column.className)} style={{ width: column.width }}>
                        <span className={cn("block min-w-0 truncate", isNumeric && "tabular-nums")}>
                          {column.render ? column.render(value, row, rowIndex) : value as ReactNode}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            }) : (
              <tr><td colSpan={columns.length || 1} className="px-3 py-8 text-center text-slate-500">{locale?.emptyText || "暂无数据"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {paging ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>{paging.showTotal ? paging.showTotal(total, range) : `共 ${total} 条`}</span>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    disabled={page <= 1}
                    onClick={(event) => {
                      event.preventDefault();
                      if (page > 1) paging.onChange?.(page - 1, pageSize);
                    }}
                  />
                </PaginationItem>
                {pageTokens.map((token, index) => (
                  <PaginationItem key={`${token}-${index}`}>
                    {token === "ellipsis" ? (
                      <PaginationEllipsis />
                    ) : (
                      <PaginationLink
                        href="#"
                        isActive={token === page}
                        onClick={(event) => {
                          event.preventDefault();
                          if (token !== page) paging.onChange?.(token, pageSize);
                        }}
                      >
                        {token}
                      </PaginationLink>
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    disabled={isLastPage}
                    onClick={(event) => {
                      event.preventDefault();
                      if (!isLastPage) paging.onChange?.(page + 1, pageSize);
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
            {paging.showSizeChanger ? (
              <Select
                className="w-[104px]"
                value={String(pageSize)}
                options={(paging.pageSizeOptions || [20, 50, 100]).map((option) => ({ value: String(option), label: `${option} 条/页` }))}
                onChange={(value) => paging.onChange?.(1, Number(value))}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildPageTokens(currentPage: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const current = Math.max(1, Math.min(pageCount, currentPage));
  const tokens = new Set<number>([1, pageCount, current, current - 1, current + 1]);

  if (current <= 3) {
    tokens.add(2);
    tokens.add(3);
    tokens.add(4);
  }

  if (current >= pageCount - 2) {
    tokens.add(pageCount - 1);
    tokens.add(pageCount - 2);
    tokens.add(pageCount - 3);
  }

  const pages = Array.from(tokens)
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);

  return pages.flatMap((page, index) => {
    const previous = pages[index - 1];
    if (previous && page - previous > 1) return ["ellipsis" as const, page];
    return [page];
  });
}

export function Tooltip({ title, children }: { title?: ReactNode; placement?: string; children?: ReactNode }) {
  return <span title={textFromNode(title)}>{children}</span>;
}

function ImageRoot({ src, alt = "", width, height, className, style }: { src?: string; alt?: string; width?: number; height?: number; className?: string; style?: CSSProperties; preview?: unknown }) {
  if (!src) return null;
  return <img src={src} alt={alt} width={width} height={height} className={className} style={style} />;
}

export const Image = Object.assign(ImageRoot, { PreviewGroup: ({ children }: { items?: string[]; children?: ReactNode }) => <>{children}</> });

export function Avatar({ src, size = 32, icon, className }: { src?: string; size?: number; icon?: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-500", className)} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : icon}
    </span>
  );
}

function Text({
  strong,
  type,
  className,
  children,
  ellipsis,
  title,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  strong?: boolean;
  type?: "secondary" | "danger";
  ellipsis?: boolean | { tooltip?: ReactNode };
}) {
  const tooltip = typeof ellipsis === "object" ? textFromNode(ellipsis.tooltip) : undefined;
  return (
    <span
      className={cn(
        strong && "font-semibold",
        type === "secondary" && "text-slate-500",
        type === "danger" && "text-red-600",
        ellipsis && "inline-block max-w-full truncate align-bottom",
        className,
      )}
      title={title ?? tooltip}
      {...props}
    >
      {children}
    </span>
  );
}

function Title({ level = 1, className, children }: { level?: 1 | 2 | 3 | 4 | 5; className?: string; children?: ReactNode }) {
  const TagName = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5";
  return <TagName className={cn("font-semibold tracking-normal text-slate-950", level === 1 && "text-3xl", level === 2 && "text-2xl", level === 3 && "text-xl", level >= 4 && "text-base", className)}>{children}</TagName>;
}

function Paragraph({ type, className, children }: HTMLAttributes<HTMLParagraphElement> & { type?: "secondary" }) {
  return <p className={cn(type === "secondary" && "text-slate-500", className)}>{children}</p>;
}

export const Typography = { Text, Title, Paragraph };

export function Row({ gutter, className, children }: { gutter?: [number, number] | number; className?: string; children?: ReactNode }) {
  const gap = Array.isArray(gutter) ? `${gutter[1]}px ${gutter[0]}px` : typeof gutter === "number" ? `${gutter}px` : undefined;
  return <div className={cn("grid", className)} style={{ gap, gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>{children}</div>;
}

export function Col({ xs = 24, sm, xl, className, children }: { xs?: number; sm?: number; xl?: number; className?: string; children?: ReactNode }) {
  const span = xl || sm || xs;
  const safeSpan = Math.max(1, Math.min(24, span));
  return <div className={cn("min-w-0", className)} style={{ gridColumn: `span ${safeSpan} / span ${safeSpan}` }}>{children}</div>;
}

export function Segmented({ value, options, onChange }: { value?: PrimitiveValue; options: Option[]; onChange?: (value: any) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-slate-100 p-1">
      {options.map((option) => (
        <button key={String(option.value)} type="button" onClick={() => onChange?.(option.value)} className={cn("rounded px-3 py-1.5 text-sm", String(value) === String(option.value) ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950")}>{option.label}</button>
      ))}
    </div>
  );
}

export const List = Object.assign(
  function List<T>({ dataSource, renderItem }: { dataSource?: T[]; renderItem?: (item: T, index: number) => ReactNode }) {
    return <div className="divide-y divide-border rounded-md border border-border">{(dataSource || []).map((item, index) => renderItem?.(item, index) ?? null)}</div>;
  },
  {
    Item: Object.assign(
      function ListItem({ actions, children }: { actions?: ReactNode[]; children?: ReactNode }) {
        return <div className="flex items-center justify-between gap-3 px-3 py-3">{children}<div className="shrink-0">{actions}</div></div>;
      },
      {
        Meta({ avatar, title, description }: { avatar?: ReactNode; title?: ReactNode; description?: ReactNode }) {
          return <div className="flex min-w-0 items-start gap-3">{avatar}<div className="min-w-0"><div className="font-medium">{title}</div><div className="mt-1 text-sm text-slate-500">{description}</div></div></div>;
        },
      },
    ),
  },
);

export const Layout = Object.assign(
  function Layout({ className, children, onSubmit }: { className?: string; children?: ReactNode; onClick?: (event: any) => void; onSubmit?: (event: FormEvent<HTMLElement>) => void }) {
    return <div className={className} onSubmit={onSubmit as any}>{children}</div>;
  },
  {
    Sider: ({ className, children }: { width?: number; collapsedWidth?: number; collapsible?: boolean; collapsed?: boolean; trigger?: ReactNode; className?: string; children?: ReactNode }) => <aside className={className}>{children}</aside>,
    Header: ({ className, children }: { className?: string; children?: ReactNode }) => <header className={className}>{children}</header>,
    Content: ({ className, children }: { className?: string; children?: ReactNode }) => <main className={className}>{children}</main>,
  },
);

export function Drawer({ open, onClose, title, children, className, ariaLabel }: { title?: ReactNode; placement?: string; size?: number; open?: boolean; onClose?: () => void; className?: string; children?: ReactNode; ariaLabel?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[5000] bg-black/40 motion-safe:transition-opacity"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn("h-full w-[292px] overflow-y-auto overscroll-contain bg-white p-4 shadow-xl", className)}
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <div id={titleId} className="min-w-0 truncate text-base font-black text-slate-950">{title}</div>
          <Button size="small" onClick={onClose} aria-label="关闭抽屉">关闭</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Menu({ items, selectedKeys }: { mode?: string; selectedKeys?: string[]; defaultOpenKeys?: string[]; openKeys?: string[]; items?: any[]; className?: string }) {
  return (
    <nav className="space-y-4">
      {(items || []).map((group) => (
        <div key={group.key}>
          <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</div>
          <div className="space-y-1">
            {(group.children || []).map((item: any) => (
              <div key={item.key} className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100", selectedKeys?.includes(item.key) && "bg-zinc-100 text-zinc-900")}>
                <span>{item.icon}</span>
                {item.label}
              </div>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export type MenuProps = { items?: any[] };

export function Breadcrumb({ items }: { items?: Array<{ title: ReactNode }> }) {
  return <div className="flex items-center gap-2 text-sm text-slate-500">{items?.map((item, index) => <span key={index}>{item.title}</span>)}</div>;
}

export function Spin({ size = "default" }: { size?: "small" | "default" | "large" }) {
  return <Loader2 className={cn("animate-spin", size === "small" ? "h-3.5 w-3.5" : size === "large" ? "h-6 w-6" : "h-4 w-4")} />;
}

type SkeletonWidth = number | string;

export function Skeleton({
  className,
  paragraph,
  title,
}: {
  className?: string;
  active?: boolean;
  paragraph?: false | { rows?: number; width?: SkeletonWidth | SkeletonWidth[] };
  title?: false | { width?: SkeletonWidth };
}) {
  const paragraphConfig = paragraph === false ? undefined : paragraph;
  if (paragraphConfig || title) {
    const rows = paragraph === false ? 0 : paragraphConfig?.rows ?? 3;
    const widths = paragraphConfig?.width;
    const widthForRow = (index: number): SkeletonWidth | undefined => Array.isArray(widths) ? widths[index] : widths;
    return (
      <div className={cn("space-y-2", className)}>
        {title !== false ? <ShadcnSkeleton className="h-4" style={{ width: typeof title === "object" ? title.width : "40%" }} /> : null}
        {Array.from({ length: rows }).map((_, index) => (
          <ShadcnSkeleton key={index} className="h-3" style={{ width: widthForRow(index) ?? (index === rows - 1 ? "72%" : "100%") }} />
        ))}
      </div>
    );
  }

  return <ShadcnSkeleton className={className} />;
}

export const DatePicker = {
  RangePicker({ value, onChange, className, placeholder }: { value?: [any, any]; onChange?: (value: [any, any] | undefined) => void; className?: string; placeholder?: [string, string] }) {
    const selectedStart = dateValueToString(value?.[0]);
    const selectedEnd = dateValueToString(value?.[1]);
    const [open, setOpen] = useState(false);
    const [draftStart, setDraftStart] = useState(selectedStart);
    const [draftEnd, setDraftEnd] = useState(selectedEnd);
    const [viewMonth, setViewMonth] = useState(() => startOfMonth(parseDate(selectedStart) || new Date()));

    useEffect(() => {
      setDraftStart(selectedStart);
      setDraftEnd(selectedEnd);
      if (selectedStart) setViewMonth(startOfMonth(parseDate(selectedStart) || new Date()));
    }, [selectedStart, selectedEnd]);

    function commit(nextStart: string, nextEnd: string, close = true) {
      if (!nextStart || !nextEnd) {
        onChange?.(undefined);
        return;
      }
      const [start, end] = compareDates(nextStart, nextEnd) <= 0 ? [nextStart, nextEnd] : [nextEnd, nextStart];
      setDraftStart(start);
      setDraftEnd(end);
      onChange?.([createDateValue(start), createDateValue(end)]);
      if (close) setOpen(false);
    }

    function pickDate(date: Date) {
      const next = formatDate(date);
      if (!draftStart || draftEnd) {
        setDraftStart(next);
        setDraftEnd("");
        return;
      }
      commit(draftStart, next);
    }

    function applyQuickRange(days: number) {
      const end = formatDate(new Date());
      const start = formatDate(addDays(new Date(), -(days - 1)));
      commit(start, end);
    }

    function clearRange(event: React.MouseEvent<HTMLButtonElement>) {
      event.preventDefault();
      event.stopPropagation();
      setDraftStart("");
      setDraftEnd("");
      onChange?.(undefined);
    }

    const choosingNewRange = open && Boolean(draftStart) && !draftEnd;
    const displayStart = open ? draftStart || selectedStart : selectedStart;
    const displayEnd = open ? (choosingNewRange ? "" : draftEnd || selectedEnd) : selectedEnd;

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <span className={cn("relative block w-full", className)}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="选择日期范围"
              className="flex h-10 w-full min-w-0 items-center rounded-md border border-input bg-white px-3 pr-16 text-sm shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                <span className={cn("truncate", !displayStart && "text-slate-400")}>{displayStart || placeholder?.[0] || "开始日期"}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className={cn("truncate", !displayEnd && "text-slate-400")}>{displayEnd || placeholder?.[1] || "结束日期"}</span>
              </span>
            </button>
          </PopoverTrigger>
          {selectedStart || selectedEnd || draftStart || draftEnd ? (
            <button
              type="button"
              aria-label="清空日期范围"
              className="absolute right-9 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={clearRange}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </span>
        <PopoverContent align="start" sideOffset={6} className="z-[5000] w-[min(720px,calc(100vw-2rem))] gap-0 overflow-hidden rounded-lg border border-border bg-white p-0 shadow-xl ring-1 ring-slate-950/10">
          <div className="grid md:grid-cols-[120px_1fr]">
            <div className="flex gap-1 border-b border-border p-2 md:block md:border-b-0 md:border-r">
              <button type="button" className="h-9 rounded-md px-3 text-left text-sm hover:bg-slate-100 md:w-full" onClick={() => applyQuickRange(7)}>
                最近一周
              </button>
              <button type="button" className="h-9 rounded-md px-3 text-left text-sm hover:bg-slate-100 md:w-full" onClick={() => applyQuickRange(30)}>
                最近一月
              </button>
            </div>
            <div className="min-w-0 p-3">
              <div className="mb-3 flex items-center justify-between">
                <button type="button" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => setViewMonth((current) => addMonths(current, -1))} aria-label="上个月">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-sm font-semibold text-slate-900">
                  {formatMonthTitle(viewMonth)} - {formatMonthTitle(addMonths(viewMonth, 1))}
                </div>
                <button type="button" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => setViewMonth((current) => addMonths(current, 1))} aria-label="下个月">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                {[viewMonth, addMonths(viewMonth, 1)].map((month) => (
                  <RangeCalendarMonth
                    key={formatMonthTitle(month)}
                    month={month}
                    start={draftStart}
                    end={draftEnd}
                    onSelect={pickDate}
                  />
                ))}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  },
};

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

function RangeCalendarMonth({
  month,
  start,
  end,
  onSelect,
}: {
  month: Date;
  start: string;
  end: string;
  onSelect: (date: Date) => void;
}) {
  const cells = getMonthCells(month);
  return (
    <div className="min-w-0">
      <div className="mb-2 text-center text-sm font-semibold text-slate-900">{formatMonthTitle(month)}</div>
      <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-500">
        {weekdays.map((day) => (
          <span key={day} className="py-1">{day}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date) => {
          const value = formatDate(date);
          const inMonth = date.getMonth() === month.getMonth();
          const selected = value === start || value === end;
          const inRange = Boolean(start && end && compareDates(value, start) >= 0 && compareDates(value, end) <= 0);
          return (
            <button
              key={value}
              type="button"
              aria-label={value}
              aria-pressed={selected}
              className={cn(
                "h-8 rounded-md text-sm transition-colors",
                !inMonth && "text-slate-300",
                inRange && !selected && "bg-primary/10 text-primary",
                selected && "bg-primary text-primary-foreground hover:bg-primary",
                !selected && !inRange && "hover:bg-slate-100",
              )}
              onClick={() => onSelect(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function dateValueToString(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return formatDate(value);
  if (typeof value.format === "function") return value.format("YYYY-MM-DD");
  return "";
}

function createDateValue(value: string) {
  return {
    format: () => value,
  };
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthTitle(date: Date) {
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function compareDates(left: string, right: string) {
  return left.localeCompare(right);
}

function getMonthCells(month: Date) {
  const first = startOfMonth(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = addDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}
