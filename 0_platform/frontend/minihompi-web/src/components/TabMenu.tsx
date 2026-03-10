import './TabMenu.css';

interface TabMenuProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { key: 'diary', label: '다이어리' },
  { key: 'photo', label: '사진첩' },
  { key: 'guestbook', label: '방명록' },
  { key: 'office', label: '사무실' },
];

function TabMenu({ activeTab, onTabChange }: TabMenuProps) {
  return (
    <div className="tab-menu">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`tab-item ${activeTab === tab.key ? 'active' : ''}`}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default TabMenu;
