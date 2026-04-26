'use client';

import { useState } from 'react';
import { DropdownMenu as DropdownMenuPrimitive, Popover as PopoverPrimitive, Select as SelectPrimitive } from 'radix-ui';
import {
  ChevronDown,
  Clock3,
  Expand,
  Shrink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverAnchor,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from '@/components/ui/popover';
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CHART_INTERVAL_OPTIONS,
  getIntervalTriggerLabel,
  type IntervalUnit,
} from '@/lib/market-terminal';
import { cn } from '@/lib/utils';

const CUSTOM_INTERVAL_UNITS: Array<{ value: IntervalUnit; label: string }> = [
  { value: 'minute', label: 'Minutes' },
  { value: 'hour', label: 'Hours' },
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
];

type ChartToolbarProps = {
  intervalAmount: number;
  intervalUnit: IntervalUnit;
  isFullscreen: boolean;
  overlayContainer?: HTMLElement | null;
  onIntervalAmountChange: (nextValue: number) => void;
  onIntervalUnitChange: (nextValue: IntervalUnit) => void;
  onToggleFullscreen: () => void;
};

function getIntervalValue(amount: number, unit: IntervalUnit) {
  return `${amount}:${unit}`;
}

export function ChartToolbar({
  intervalAmount,
  intervalUnit,
  isFullscreen,
  overlayContainer,
  onIntervalAmountChange,
  onIntervalUnitChange,
  onToggleFullscreen,
}: ChartToolbarProps) {
  const [isCustomIntervalOpen, setIsCustomIntervalOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState(String(intervalAmount));
  const [customUnit, setCustomUnit] = useState<IntervalUnit>(intervalUnit);

  const activeIntervalLabel = getIntervalTriggerLabel(intervalAmount, intervalUnit);

  const handleCustomIntervalOpenChange = (open: boolean) => {
    if (open) {
      setCustomAmount(String(intervalAmount));
      setCustomUnit(intervalUnit);
    }

    setIsCustomIntervalOpen(open);
  };

  const handlePresetSelect = (nextValue: string) => {
    const [amountValue, unitValue] = nextValue.split(':');
    const parsedAmount = Number.parseInt(amountValue, 10);

    if (!Number.isFinite(parsedAmount)) {
      return;
    }

    onIntervalAmountChange(Math.max(1, parsedAmount));
    onIntervalUnitChange(unitValue as IntervalUnit);
  };

  const handleCustomApply = () => {
    const parsedAmount = Number.parseInt(customAmount, 10);

    if (!Number.isFinite(parsedAmount) || parsedAmount < 1) {
      return;
    }

    onIntervalAmountChange(parsedAmount);
    onIntervalUnitChange(customUnit);
    setIsCustomIntervalOpen(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 px-2 py-2 md:px-3">
      <Popover open={isCustomIntervalOpen} onOpenChange={handleCustomIntervalOpenChange}>
        <PopoverAnchor asChild>
          <div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ButtonGroup aria-label="Chart interval controls">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-slate-200 hover:bg-white/10 hover:text-white"
                    aria-label={`Select chart interval, current interval ${activeIntervalLabel}`}
                  >
                    <Clock3 className="size-3.5" />
                    <span className="font-medium">{activeIntervalLabel}</span>
                    <ChevronDown className="size-3.5 text-slate-400" />
                  </Button>
                </ButtonGroup>
              </DropdownMenuTrigger>
              <DropdownMenuPortal container={overlayContainer ?? undefined}>
                <DropdownMenuPrimitive.Content
                  data-slot="dropdown-menu-content"
                  sideOffset={4}
                  align="end"
                  className={cn(
                    'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
                    'w-56'
                  )}
                >
                  <DropdownMenuLabel>Intervals</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={getIntervalValue(intervalAmount, intervalUnit)}
                    onValueChange={handlePresetSelect}
                  >
                    {CHART_INTERVAL_OPTIONS.map(option => (
                      <DropdownMenuRadioItem
                        key={getIntervalValue(option.amount, option.unit)}
                        value={getIntervalValue(option.amount, option.unit)}
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setIsCustomIntervalOpen(true)}>
                    Add custom interval
                  </DropdownMenuItem>
                </DropdownMenuPrimitive.Content>
              </DropdownMenuPortal>
            </DropdownMenu>
          </div>
        </PopoverAnchor>

        <PopoverPrimitive.Portal container={overlayContainer ?? undefined}>
          <PopoverPrimitive.Content
            data-slot="popover-content"
            align="start"
            sideOffset={4}
            className={cn(
              'z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-4 rounded-lg bg-popover p-2.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
              'w-72 gap-3 rounded-2xl p-3'
            )}
          >
            <PopoverHeader>
              <PopoverTitle>Custom interval</PopoverTitle>
              <PopoverDescription>
                Enter a positive interval amount and choose the unit for the chart aggregation.
              </PopoverDescription>
            </PopoverHeader>

            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Amount</span>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={customAmount}
                  onChange={event => setCustomAmount(event.target.value)}
                  className="h-8 bg-white/5 text-sm text-white"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Unit</span>
                <Select value={customUnit} onValueChange={value => setCustomUnit(value as IntervalUnit)}>
                  <SelectTrigger size="sm" className="h-8 w-full bg-white/5 text-sm text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPrimitive.Portal container={overlayContainer ?? undefined}>
                    <SelectPrimitive.Content
                      data-slot="select-content"
                      data-align-trigger={true}
                      position="item-aligned"
                      align="start"
                      className={cn(
                        'relative z-50 max-h-(--radix-select-content-available-height) min-w-32 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95'
                      )}
                    >
                      <SelectPrimitive.Viewport>
                        {CUSTOM_INTERVAL_UNITS.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectPrimitive.Viewport>
                    </SelectPrimitive.Content>
                  </SelectPrimitive.Portal>
                </Select>
              </label>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-slate-300 hover:text-white"
                  onClick={() => setIsCustomIntervalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="button" size="sm" className="h-8 px-3" onClick={handleCustomApply}>
                  Apply
                </Button>
              </div>
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </Popover>

      <ButtonGroup aria-label="Chart display controls">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit chart fullscreen' : 'Enter chart fullscreen'}
        >
          {isFullscreen ? <Shrink className="size-3.5" /> : <Expand className="size-3.5" />}
        </Button>
      </ButtonGroup>
    </div>
  );
}