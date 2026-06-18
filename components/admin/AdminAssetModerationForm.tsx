"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Form, Input, Modal, Radio, Space, Typography } from "@/components/ui/shadcn-compat";
import { SafetyCertificateOutlined } from "@/components/ui/ant-icons-compat";

type ModerationValue = {
  action: "hide" | "pass" | "escalate";
  reason: string;
};

const actionOptions = [
  { value: "hide", label: "下架作品", help: "用户端不再展示，适合违规、低质或版权风险内容。" },
  { value: "pass", label: "标记通过", help: "确认内容可继续展示。" },
  { value: "escalate", label: "转人工复核", help: "证据不足或需要负责人判断时使用。" },
];

export function AdminAssetModerationForm({
  sourceId,
  sourceType,
}: {
  sourceId: string;
  sourceType: string;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<ModerationValue>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(values: ModerationValue) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/assets/${sourceId}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType, action: values.action, reason: values.reason }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `处理失败 (${res.status})`);
      message.success("内容处理记录已保存");
      setOpen(false);
      form.resetFields();
      router.refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "处理失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="small" icon={<SafetyCertificateOutlined />} onClick={() => setOpen(true)}>
        处理内容
      </Button>
      <Modal
        title="处理内容审核"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        okText="保存处理结果"
        confirmLoading={loading}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          选择一个运营动作并填写原因。原因会进入审计记录，便于后续客服、财务和负责人追溯。
        </Typography.Paragraph>
        <Form<ModerationValue>
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={{ action: "hide" }}
        >
          <Form.Item name="action" label="处理动作" rules={[{ required: true }]}>
            <Radio.Group className="w-full">
              <Space orientation="vertical" className="w-full">
                {actionOptions.map((item) => (
                  <Radio key={item.value} value={item.value}>
                    <Space orientation="vertical" size={0}>
                      <Typography.Text strong>{item.label}</Typography.Text>
                      <Typography.Text type="secondary" className="text-xs">{item.help}</Typography.Text>
                    </Space>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="reason" label="处理原因" rules={[{ required: true, min: 4, message: "请填写至少 4 个字的原因" }]}>
            <Input.TextArea rows={3} maxLength={240} placeholder="例如：商品图含违规元素，先下架并等待复核" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
