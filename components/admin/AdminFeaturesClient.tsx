"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  App as ShadcnApp,
} from "@/components/ui/shadcn-compat";
import type { ColumnsType } from "@/components/ui/shadcn-compat";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@/components/ui/lucide-icons-compat";
import type { AdminFeatureConfig, AdminFeatureRegistry } from "@/lib/admin/features";

type AdminFeaturesClientProps = {
  registry: AdminFeatureRegistry;
};

type FeatureFormValue = Omit<AdminFeatureConfig, "updatedAt"> & {
  reason: string;
};

const moduleOptions = [
  { label: "首页", value: "home" },
  { label: "模特图", value: "aiShoots" },
  { label: "工作流助手", value: "assistant" },
  { label: "素材生成", value: "tools" },
  { label: "AI 视频", value: "aiVideo" },
  { label: "作品库", value: "works" },
];

const statusOptions = [
  { label: "启用", value: "active" },
  { label: "停用", value: "disabled" },
  { label: "归档", value: "archived" },
];

export function AdminFeaturesClient({ registry }: AdminFeaturesClientProps) {
  const router = useRouter();
  const { message, modal } = ShadcnApp.useApp();
  const [form] = Form.useForm<FeatureFormValue>();
  const [editing, setEditing] = useState<AdminFeatureConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const features = registry.features;
  const metrics = useMemo(
    () => ({
      total: features.length,
      active: features.filter((item) => item.status === "active" && item.enabled).length,
      hidden: features.filter((item) => !item.navVisible).length,
      archived: features.filter((item) => item.status === "archived").length,
    }),
    [features],
  );

  const columns: ColumnsType<AdminFeatureConfig> = [
    {
      title: "功能",
      dataIndex: "label",
      width: 260,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{row.label}</Typography.Text>
          <Typography.Text type="secondary" className="font-mono text-xs">
            {row.key}
          </Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            {row.description || "-"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "分组",
      dataIndex: "module",
      width: 110,
      filters: moduleOptions.map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value, row) => row.module === value,
      render: (value) => moduleOptions.find((item) => item.value === value)?.label || value,
    },
    {
      title: "路由",
      dataIndex: "href",
      width: 180,
      render: (value: string) => <Typography.Text className="font-mono text-xs">{value}</Typography.Text>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      filters: statusOptions.map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value, row) => row.status === value,
      render: (_, row) => <FeatureStatusTag feature={row} />,
    },
    {
      title: "导航",
      dataIndex: "navVisible",
      width: 90,
      render: (value: boolean) => <Tag color={value ? "blue" : "default"}>{value ? "展示" : "隐藏"}</Tag>,
    },
    {
      title: "模型/灵点",
      width: 180,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text className="text-xs">{row.defaultModel || "未指定模型"}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            {row.creditPolicy || "未配置灵点策略"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "后台页",
      dataIndex: "adminHref",
      width: 160,
      render: (value: string) => <Typography.Text className="font-mono text-xs">{value}</Typography.Text>,
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 150,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(row)}>
            编辑
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} disabled={row.status === "archived"} onClick={() => archiveFeature(row)}>
            归档
          </Button>
        </Space>
      ),
    },
  ];

  function startCreate() {
    setEditing(null);
    form.setFieldsValue({
      key: "",
      label: "",
      module: "aiShoots",
      href: "",
      description: "",
      enabled: true,
      navVisible: true,
      defaultModel: "",
      creditPolicy: "",
      adminHref: "/admin/generations",
      status: "active",
      notes: "",
      reason: "创建功能运营配置",
    });
    setOpen(true);
  }

  function startEdit(feature: AdminFeatureConfig) {
    setEditing(feature);
    form.setFieldsValue({
      ...feature,
      reason: "更新功能运营配置",
    });
    setOpen(true);
  }

  async function submit(values: FeatureFormValue) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          reason: values.reason,
          feature: {
            ...values,
            enabled: values.status === "active" ? values.enabled : false,
            navVisible: values.status === "active" ? values.navVisible : false,
          },
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `保存失败 (${res.status})`);
      message.success("功能配置已发布");
      setOpen(false);
      router.refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  function archiveFeature(feature: AdminFeatureConfig) {
    let reason = `归档 ${feature.label} 功能配置`;
    modal.confirm({
      title: `归档 ${feature.label}`,
      content: (
        <Space orientation="vertical" className="w-full">
          <Typography.Paragraph className="!mb-0">
            归档只会发布新的后台配置版本，不会删除前端路由。
          </Typography.Paragraph>
          <Input.TextArea defaultValue={reason} minLength={4} maxLength={240} onChange={(event) => { reason = event.target.value; }} />
        </Space>
      ),
      okText: "确认归档",
      okButtonProps: { danger: true },
      async onOk() {
        const res = await fetch("/api/admin/features", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive", key: feature.key, reason }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `归档失败 (${res.status})`);
        message.success("功能配置已归档");
        router.refresh();
      },
    });
  }

  return (
    <Space orientation="vertical" size={16} className="w-full">
      <div className="admin-page-hero">
        <div>
          <Typography.Text className="admin-page-eyebrow">Features</Typography.Text>
          <Typography.Title level={2} className="!mb-1 !mt-1">
            功能管理
          </Typography.Title>
          <Typography.Paragraph className="!mb-0 !text-slate-500">
            用版本化配置统一管理前端功能展示、模型、灵点策略和后台关联入口。
          </Typography.Paragraph>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={startCreate}>
          新增功能配置
        </Button>
      </div>

      {registry.warnings.length > 0 && (
        <Alert type="warning" showIcon message="功能配置数据源提示" description={registry.warnings.slice(0, 3).join("；")} />
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="总功能" value={metrics.total} />
        <Metric title="启用中" value={metrics.active} tone="green" />
        <Metric title="导航隐藏" value={metrics.hidden} tone="blue" />
        <Metric title="已归档" value={metrics.archived} tone="red" />
      </div>

      <Card
        title="功能配置列表"
        extra={
          <Space>
            <Tag>{registry.configKey}</Tag>
            <Tag color={registry.activeVersionStatus === "published" ? "green" : "default"}>
              {registry.activeVersionStatus || "default"}
            </Tag>
          </Space>
        }
      >
        <Table<AdminFeatureConfig>
          size="small"
          rowKey="key"
          columns={columns}
          dataSource={features}
          scroll={{ x: 1250 }}
          pagination={{ pageSize: 12, showSizeChanger: true }}
        />
      </Card>

      <Modal
        title={editing ? `编辑 ${editing.label}` : "新增功能配置"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        okText="发布配置"
        confirmLoading={submitting}
        width={760}
        destroyOnHidden
      >
        <Form<FeatureFormValue> form={form} layout="vertical" onFinish={submit}>
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="key" label="功能 Key" rules={[{ required: true, message: "请输入功能 Key" }]}>
              <Input disabled={Boolean(editing)} placeholder="tryon" />
            </Form.Item>
            <Form.Item name="label" label="展示名" rules={[{ required: true, message: "请输入展示名" }]}>
              <Input placeholder="服装上身" />
            </Form.Item>
            <Form.Item name="module" label="分组" rules={[{ required: true }]}>
              <Select options={moduleOptions} />
            </Form.Item>
            <Form.Item name="status" label="状态" rules={[{ required: true }]}>
              <Select options={statusOptions} />
            </Form.Item>
            <Form.Item name="href" label="前端路由" rules={[{ required: true, message: "请输入前端路由" }]}>
              <Input placeholder="/create" />
            </Form.Item>
            <Form.Item name="adminHref" label="后台关联页" rules={[{ required: true, message: "请输入后台关联页" }]}>
              <Input placeholder="/admin/generations" />
            </Form.Item>
            <Form.Item name="defaultModel" label="默认模型">
              <Input placeholder="gpt-image-2" />
            </Form.Item>
            <Form.Item name="creditPolicy" label="灵点策略">
              <Input placeholder="按模型和尺寸计费" />
            </Form.Item>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="enabled" label="允许使用" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
            <Form.Item name="navVisible" label="导航展示" valuePropName="checked">
              <Switch checkedChildren="展示" unCheckedChildren="隐藏" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="功能描述">
            <Input.TextArea rows={2} maxLength={240} />
          </Form.Item>
          <Form.Item name="notes" label="运营备注">
            <Input.TextArea rows={3} maxLength={1000} />
          </Form.Item>
          <Form.Item name="reason" label="发布原因" rules={[{ required: true, min: 4, message: "请填写至少 4 个字的原因" }]}>
            <Input.TextArea rows={2} maxLength={240} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function Metric({ title, value, tone = "default" }: { title: string; value: number; tone?: "default" | "green" | "blue" | "red" }) {
  return (
    <Card>
      <Typography.Text type="secondary">{title}</Typography.Text>
      <div className="mt-2">
        <Tag color={tone} className="!text-base !font-bold">
          {value}
        </Tag>
      </div>
    </Card>
  );
}

function FeatureStatusTag({ feature }: { feature: AdminFeatureConfig }) {
  if (feature.status === "archived") return <Tag color="default">已归档</Tag>;
  if (!feature.enabled || feature.status === "disabled") return <Tag color="orange">停用</Tag>;
  return <Tag color="green">启用</Tag>;
}
