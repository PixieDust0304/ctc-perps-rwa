"use client";

interface PriceInfo {
  id: number;
  name: string;
  symbol: string;
  price: number;
  fresh: boolean;
}

interface MarketSelectorProps {
  prices: PriceInfo[];
  selectedFeedId: number;
  onSelect: (feedId: number) => void;
}

export function MarketSelector({
  prices,
  selectedFeedId,
  onSelect,
}: MarketSelectorProps) {
  return (
    <div className="flex gap-1 px-4 pt-4 overflow-x-auto">
      {prices.map((feed) => (
        <button
          key={feed.id}
          onClick={() => onSelect(feed.id)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
            selectedFeedId === feed.id
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          <span>{feed.name}</span>
          <span className="ml-2 font-mono">
            ${feed.price > 0 ? feed.price.toFixed(2) : "---"}
          </span>
          <span
            className={`ml-2 inline-block w-2 h-2 rounded-full ${
              feed.fresh ? "bg-green-400" : "bg-red-400"
            }`}
          />
        </button>
      ))}
    </div>
  );
}
