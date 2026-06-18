"use client";

import type { ComponentType } from "react";
import {
  Activity,
  AlertTriangle,
  AppWindow,
  Archive,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  CircleX,
  Clock3,
  CreditCard,
  Database,
  Download,
  FileCheck2,
  FlaskConical,
  Flame,
  Gauge,
  Image,
  KeyRound,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
  StopCircle,
  Trash2,
  UserPlus,
  Users,
  Wrench,
} from "lucide-react";

type IconProps = { className?: string; style?: React.CSSProperties };

function wrap(Icon: ComponentType<{ className?: string; style?: React.CSSProperties }>) {
  return function CompatIcon({ className, style }: IconProps) {
    return <Icon className={className || "h-4 w-4"} style={style} />;
  };
}

export const AlertOutlined = wrap(AlertTriangle);
export const ApiOutlined = wrap(Activity);
export const AppstoreOutlined = wrap(AppWindow);
export const AuditOutlined = wrap(FileCheck2);
export const BarChartOutlined = wrap(BarChart3);
export const CheckCircleOutlined = wrap(CheckCircle2);
export const CloseCircleOutlined = wrap(CircleX);
export const ClockCircleOutlined = wrap(Clock3);
export const ControlOutlined = wrap(Gauge);
export const CreditCardOutlined = wrap(CreditCard);
export const DashboardOutlined = wrap(Gauge);
export const DatabaseOutlined = wrap(Database);
export const DeleteOutlined = wrap(Trash2);
export const DollarCircleOutlined = wrap(CircleDollarSign);
export const DollarOutlined = wrap(CircleDollarSign);
export const DownloadOutlined = wrap(Download);
export const EditOutlined = wrap(SquarePen);
export const ExperimentOutlined = wrap(FlaskConical);
export const FileAddOutlined = wrap(FileCheck2);
export const FileProtectOutlined = wrap(FileCheck2);
export const FireOutlined = wrap(Flame);
export const KeyOutlined = wrap(KeyRound);
export const MenuFoldOutlined = wrap(PanelLeftClose);
export const MenuOutlined = wrap(Menu);
export const MenuUnfoldOutlined = wrap(PanelLeftOpen);
export const PictureOutlined = wrap(Image);
export const PlusCircleOutlined = wrap(Plus);
export const PlusOutlined = wrap(Plus);
export const ReloadOutlined = wrap(RefreshCw);
export const RollbackOutlined = wrap(RotateCcw);
export const SafetyCertificateOutlined = wrap(ShieldCheck);
export const SearchOutlined = wrap(Search);
export const SettingOutlined = wrap(Settings);
export const StopOutlined = wrap(StopCircle);
export const TeamOutlined = wrap(Users);
export const ToolOutlined = wrap(Wrench);
export const UserAddOutlined = wrap(UserPlus);
export const UserOutlined = wrap(Users);
