"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Form, Input, Modal, Space, Typography } from "@/components/ui/shadcn-compat";
import { CheckCircleOutlined, CloseCircleOutlined } from "@/components/ui/lucide-icons-compat";

type ApprovalAction = "approve" | "reject";

export function AdminOperationRequestActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ reason: string }>();
  const [action, setAction] = useState<ApprovalAction | null>(null);
  const [loading, setLoading] = useState(false);

  if (status !== "pending") return <Typography.Text type="secondary">已处理</Typography.Text>;

  async function submit(values: { reason: string }) {
    if (!action) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/operation-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: values.reason }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `审批失败 (${res.status})`);
      message.success(action === "approve" ? "审批已通过" : "审批已驳回");
      setAction(null);
      form.resetFields();
      router.refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "审批失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Space>
        <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => setAction("approve")}>
          通过
        </Button>
        <Button size="small" danger icon={<CloseCircleOutlined />} onClick={() => setAction("reject")}>
          驳回
        </Button>
      </Space>
      <Modal
        title={action === "approve" ? "确认通过申请" : "确认驳回申请"}
        open={Boolean(action)}
        onCancel={() => setAction(null)}
        onOk={() => form.submit()}
        okText={action === "approve" ? "确认通过" : "确认驳回"}
        okButtonProps={{ danger: action === "reject" }}
        confirmLoading={loading}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          请用业务语言说明原因，例如“任务失败已核实，补偿合理”或“证据不足，需客服补充截图”。
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="reason" label="审批原因" rules={[{ required: true, min: 4, message: "请填写至少 4 个字的原因" }]}>
            <Input.TextArea rows={3} maxLength={240} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
