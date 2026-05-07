import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { 
  Plus, 
  Search, 
  Bell, 
  CheckCircle2, 
  Trash2, 
  Menu, 
  X, 
  Phone, 
  Mail, 
  MapPin, 
  Calendar, 
  User, 
  ArrowRight,
  LogOut,
  LogIn,
  ImagePlus,
  FileVideo,
  Film,
  UploadCloud,
  FileText
} from 'lucide-react';

// --- Types ---
type ItemStatus = 'LOST' | 'FOUND' | 'CLAIMED';

interface Item {
  id: number;
  title: string;
  description: string;
  category: string;
  contact: string;
  media_urls: string[] | null;
  status: ItemStatus;
  location: string;
  reporter_name: string;
  reporter_roll: string;
  reporter_email: string;
  created_at: string;
  verification_question?: string;
  verification_answer?: string;
}

interface Notification {
  id: string;
  type: 'new_report' | 'resolved';
  itemName: string;
  reportType: 'LOST' | 'FOUND';
  reporter: string;
  ts: number;
  read: boolean;
}

// --- Constants ---
const CATEGORIES = ['ID Card', 'Wallet', 'Stationery', 'Electronics', 'Bag/Books', 'Clothing', 'Keys', 'Other'];
const LOCATIONS = ['Classroom', 'Laboratory', 'Library', 'Cafeteria', 'Corridor', 'Auditorium', 'Sports Ground', 'Other'];

const CAT_EMOJI: Record<string, string> = {
  'ID Card': '🪪', 'Wallet': '👛', 'Stationery': '✏️', 'Electronics': '🎧',
  'Bag/Books': '📚', 'Clothing': '👕', 'Keys': '🔑', 'Other': '📦'
};

const LOC_EMOJI: Record<string, string> = {
  'Classroom': '🏫', 'Laboratory': '🔬', 'Library': '📖', 'Cafeteria': '🍽️',
  'Corridor': '🚶', 'Auditorium': '🎭', 'Sports Ground': '⚽', 'Other': '📍'
};

export default function App() {
  // Navigation & UI State
  const [activePage, setActivePage] = useState<'home' | 'listings' | 'how' | 'admin'>('home');
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    id: number;
    type: 'resolve' | 'delete';
    title: string;
  } | null>(null);

  // Data State
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [potentialMatches, setPotentialMatches] = useState<Item[]>([]);
  
  // Filter & Search State
  const [typeFilter, setTypeFilter] = useState<'all' | 'LOST' | 'FOUND' | 'CLAIMED'>('all');
  const [catFilter, setCatFilter] = useState('');
  const [locFilter, setLocFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // --- Matching Logic ---
  const findMatchesFor = (item: Item) => {
    return items.filter(i => 
      i.id !== item.id && 
      i.status !== 'CLAIMED' &&
      i.status !== item.status && // Match LOST with FOUND
      (i.category === item.category || i.location === item.location) &&
      (i.title.toLowerCase().includes(item.title.toLowerCase()) || 
       item.title.toLowerCase().includes(i.title.toLowerCase()))
    );
  };

  useEffect(() => {
    if (selectedItem) {
      setPotentialMatches(findMatchesFor(selectedItem));
    } else {
      setPotentialMatches([]);
    }
  }, [selectedItem, items]);

  // Configuration Check
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const isConfigured = supabaseUrl && !supabaseUrl.includes('your-project-id') && !supabaseUrl.includes('placeholder');

  // Form State
  const [formData, setFormData] = useState({
    type: '' as 'LOST' | 'FOUND' | '',
    name: '',
    roll: '',
    phone: '',
    email: '',
    title: '',
    category: '',
    location: '',
    desc: '',
    verification_question: '',
    verification_answer: '',
    date: new Date().toISOString().split('T')[0],
    media: [] as File[]
  });
  const [duplicateMatches, setDuplicateMatches] = useState<Item[]>([]);
  const [isVerified, setIsVerified] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');

  const normalizeAnswer = (text: string) => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "") // Remove punctuation
      .replace(/\s+/g, " "); // Normalize whitespace
  };

  const validateVerification = () => {
    if (!selectedItem) return;
    
    const normalizedUser = normalizeAnswer(userAnswer);
    const normalizedTarget = normalizeAnswer(selectedItem.verification_answer || '');
    
    // Basic fuzzy matching: if either is a substring of the other or exact match
    if (normalizedTarget && (normalizedUser.includes(normalizedTarget) || normalizedTarget.includes(normalizedUser)) && normalizedUser.length >= Math.min(3, normalizedTarget.length)) {
      setIsVerified(true);
      showToast("Verification Successful! Contact revealed.", "success");
    } else {
      showToast("The answer provided doesn't match the finder's records. Please try to be more specific.", "error");
    }
  };

  // Reset verification when item changes
  useEffect(() => {
    setIsVerified(false);
    setUserAnswer('');
  }, [selectedItem]);

  // Duplicate Check while typing
  useEffect(() => {
    if (formData.title.length > 3) {
      const matches = items.filter(i => 
        i.status !== 'CLAIMED' &&
        i.status !== formData.type && // If I report LOST, show me FOUND items
        (i.title.toLowerCase().includes(formData.title.toLowerCase()) || 
         formData.title.toLowerCase().includes(i.title.toLowerCase()))
      );
      setDuplicateMatches(matches);
    } else {
      setDuplicateMatches([]);
    }
  }, [formData.title, formData.type, items]);
  const [uploading, setUploading] = useState(false);

  // --- Effects ---
  useEffect(() => {
    fetchItems();
    loadNotifications();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // --- Functions ---
  const fetchItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      showToast('Error fetching items', 'error');
    } else {
      setItems(data || []);
    }
    setLoading(false);
  };

  const loadNotifications = () => {
    const saved = localStorage.getItem('findit_notifs');
    if (saved) setNotifications(JSON.parse(saved));
  };

  const saveNotifications = (newNotifs: Notification[]) => {
    setNotifications(newNotifs);
    localStorage.setItem('findit_notifs', JSON.stringify(newNotifs));
  };

  const addNotification = (notif: Omit<Notification, 'id' | 'ts' | 'read'>) => {
    const newNotif: Notification = {
      ...notif,
      id: Date.now().toString(),
      ts: Date.now(),
      read: false
    };
    saveNotifications([newNotif, ...notifications].slice(0, 50));
  };

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, type });
  };

  const handleFileUpload = async (files: File[]) => {
    const urls: string[] = [];
    
    for (const file of files) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { data, error: uploadError } = await supabase.storage
        .from('item-images')
        .upload(filePath, file);

      if (uploadError) {
        console.error('Supabase Storage Error Details:', uploadError);
        
        // Handle 404 (Bucket not found)
        if (uploadError.message === 'The resource was not found' || (uploadError as any).status === 404) {
          throw new Error('Bucket Not Found! Please go to Supabase -> Storage, create a bucket named exactly "item-images" and set it to PUBLIC.');
        }
        
        // Handle 403 (Permission denied)
        if (uploadError.message.toLowerCase().includes('permission') || (uploadError as any).status === 403) {
          throw new Error('Permission Denied! In Supabase SQL Editor, run this: \n\n' + 
            'CREATE POLICY "Allow Anon Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = \'item-images\'); \n' +
            'CREATE POLICY "Allow Anon Select" ON storage.objects FOR SELECT USING (bucket_id = \'item-images\');');
        }

        throw new Error(`Storage Upload Failed: ${uploadError.message} (Status: ${(uploadError as any).status})`);
      }

      if (!data) {
        throw new Error('Upload succeeded but no data was returned from Supabase.');
      }

      const { data: { publicUrl } } = supabase.storage
        .from('item-images')
        .getPublicUrl(filePath);
        
      urls.push(publicUrl);
    }

    return urls;
  };

  const submitReport = async () => {
    if (!formData.type || !formData.name || !formData.phone || !formData.title || !formData.category || !formData.location) {
      showToast('Please fill all required fields', 'error');
      return;
    }

    setUploading(true);
    try {
      // 1. Check Connection/Config
      const currentUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!currentUrl || currentUrl.includes('placeholder') || currentUrl.includes('your-project-id')) {
        throw new Error('Supabase is not connected. Please go to "Settings" -> "Secrets" and add your real VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from Supabase Project Settings -> API.');
      }

      let media_urls: string[] = [];
      if (formData.media.length > 0) {
        media_urls = await handleFileUpload(formData.media);
      }

      // 2. Database Insert
      const { error, status, statusText } = await supabase.from('items').insert([{
        title: formData.title,
        description: formData.desc,
        category: formData.category,
        contact: formData.phone,
        media_urls,
        status: formData.type,
        location: formData.location,
        reporter_name: formData.name,
        reporter_roll: formData.roll,
        reporter_email: formData.email,
        verification_question: formData.type === 'FOUND' ? formData.verification_question : null,
        verification_answer: formData.type === 'FOUND' ? formData.verification_answer : null
      }]);

      if (error) {
        console.error('Database insertion error:', error);
        if (error.message.includes('column "media_urls" does not exist')) {
          throw new Error('Database Schema Mismatch: Did you run the updated SQL in Supabase? The table needs a "media_urls" column (type TEXT[]).');
        }
        throw new Error(`Database Error: ${error.message} (Status: ${status} ${statusText})`);
      }

      showToast(`Success! Your ${formData.type} report has been posted.`, 'success');
      setShowReportModal(false);
      resetForm();
      fetchItems();
      addNotification({
        type: 'new_report',
        itemName: formData.title,
        reportType: formData.type as 'LOST' | 'FOUND',
        reporter: formData.name
      });
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const resolveItem = async (id: number) => {
    console.log('Resolving item:', id);
    
    // Save old state in case we need to roll back
    const oldItems = [...items];
    
    // Optimistic Update
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, status: 'CLAIMED' } : item
    ));

    try {
      const { error, data } = await supabase
        .from('items')
        .update({ status: 'CLAIMED' })
        .eq('id', id)
        .select(); 

      if (error) {
        showToast('Error updating status', 'error');
        setItems(oldItems); // Rollback
      } else if (data && data.length === 0) {
        showToast('Update failed: Run SQL POLICY for UPDATE in Supabase.', 'error');
        setItems(oldItems);
      } else {
        showToast('Item marked as resolved!', 'success');
        const item = oldItems.find(i => i.id === id);
        if (item) {
          addNotification({
            type: 'resolved',
            itemName: item.title,
            reportType: item.status as 'LOST' | 'FOUND',
            reporter: item.reporter_name
          });
        }
        setSelectedItem(null);
        fetchItems();
      }
    } catch (err: any) {
      console.error('Resolve error:', err);
      showToast('Unexpected error resolving item', 'error');
      setItems(oldItems);
    }
  };

  const deleteItem = async (id: number) => {
    console.log('Deleting item:', id);
    
    // Save old state
    const oldItems = [...items];
    
    // Optimistic Update
    setItems(prev => prev.filter(item => item.id !== id));

    try {
      const { error, data } = await supabase
        .from('items')
        .delete()
        .eq('id', id)
        .select();

      if (error) {
        console.error('Database delete error:', error);
        showToast('Error deleting item', 'error');
        setItems(oldItems); // Rollback
      } else if (data && data.length === 0) {
        // This often happens if RLS is enabled but delete is not allowed for anon users
        showToast('Delete failed: Run SQL POLICY for DELETE in Supabase.', 'error');
        setItems(oldItems);
      } else {
        showToast('Item deleted successfully', 'info');
        fetchItems();
      }
    } catch (err: any) {
      console.error('Delete error:', err);
      showToast('Unexpected error during deletion', 'error');
      setItems(oldItems);
    }
  };

  const exportToCSV = () => {
    if (items.length === 0) {
      showToast('No data to export!', 'error');
      return;
    }

    const headers = ['ID', 'Title', 'Status', 'Category', 'Location', 'Reporter Name', 'Roll', 'Contact', 'Email', 'Created At'];
    const rows = items.map(item => [
      item.id,
      `"${item.title?.replace(/"/g, '""') || ''}"`,
      item.status,
      item.category,
      item.location,
      `"${item.reporter_name?.replace(/"/g, '""') || ''}"`,
      item.reporter_roll,
      item.contact,
      item.reporter_email,
      item.created_at
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `FindIt_Campus_Reports_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV Exported Successfully!', 'success');
  };

  const resetForm = () => {
    setFormData({
      type: '', name: '', roll: '', phone: '', email: '',
      title: '', category: '', location: '', desc: '',
      verification_question: '',
      verification_answer: '',
      date: new Date().toISOString().split('T')[0], media: []
    });
    setDuplicateMatches([]);
  };

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d < 7) return `${d}d ago`;
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const filteredItems = items.filter(item => {
    const matchesType = typeFilter === 'all' ? true : (typeFilter === 'CLAIMED' ? item.status === 'CLAIMED' : item.status === typeFilter);
    const matchesCat = catFilter ? item.category === catFilter : true;
    const matchesLoc = locFilter ? item.location === locFilter : true;
    const matchesSearch = searchQuery ? (
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchQuery.toLowerCase())
    ) : true;
    return matchesType && matchesCat && matchesLoc && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-beige selection:bg-teal selection:text-white">
      {!isConfigured && (
        <div className="bg-red-600 text-white p-3 text-sm font-bold flex items-center justify-center gap-4 animate-pulse">
          <Bell size={20} />
          <span>Supabase is not connected! Please add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your Secrets.</span>
        </div>
      )}
      <Navbar 
        activePage={activePage} 
        setActivePage={setActivePage} 
        setShowReportModal={setShowReportModal}
        notifications={notifications}
        setShowNotifPanel={setShowNotifPanel}
        showNotifPanel={showNotifPanel}
        saveNotifications={saveNotifications}
        getTimeAgo={getTimeAgo}
      />

      {/* Hero Section */}
      {activePage === 'home' && (
        <header className="bg-gradient-to-br from-navy to-teal relative overflow-hidden pt-20 pb-28 px-6 text-center">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(200,217,230,0.15),transparent)] pointer-events-none" />
          <div className="relative z-10 max-w-4xl mx-auto">
             <div className="inline-flex items-center gap-2 bg-sky/20 border border-sky/30 px-4 py-1.5 rounded-full text-sky text-xs font-bold tracking-wider uppercase mb-6">
                🎓 Campus Connected Platform
             </div>
             <h1 className="font-serif text-4xl md:text-6xl text-white font-bold leading-tight mb-6">
               Lost something? Found something? <br />
               <i className="text-sky not-italic text-shadow-glow">We've got you.</i>
             </h1>
             <p className="text-sky/80 text-lg md:text-xl font-light mb-10 max-w-2xl mx-auto leading-relaxed">
               A structured, campus-wide platform to report and track lost & found items. Join 2,000+ students reclaiming their belongings.
             </p>
             <div className="flex flex-wrap justify-center gap-4">
                <button className="bg-white text-navy font-bold px-8 py-4 rounded-2xl shadow-xl hover:-translate-y-1 transition-all" onClick={() => setShowReportModal(true)}>Report Now</button>
                <button className="bg-transparent text-white border-2 border-white/40 font-bold px-8 py-4 rounded-2xl hover:bg-white/10 transition-all" onClick={() => setActivePage('listings')}>Browse Listings</button>
             </div>
             
             {/* Stats Inline */}
             <div className="mt-16 flex flex-wrap justify-center gap-6">
                <div className="bg-white/10 backdrop-blur-md border border-white/10 px-8 py-5 rounded-2xl text-center">
                  <div className="text-3xl font-serif font-bold text-white mb-1">{items.filter(i => i.status === 'LOST' && i.status !== 'CLAIMED').length}</div>
                  <div className="text-[10px] font-bold text-sky uppercase tracking-widest">Active Lost</div>
                </div>
                <div className="bg-white/10 backdrop-blur-md border border-white/10 px-8 py-5 rounded-2xl text-center">
                  <div className="text-3xl font-serif font-bold text-white mb-1">{items.filter(i => i.status === 'FOUND' && i.status !== 'CLAIMED').length}</div>
                  <div className="text-[10px] font-bold text-sky uppercase tracking-widest">Active Found</div>
                </div>
                <div className="bg-white/10 backdrop-blur-md border border-white/10 px-8 py-5 rounded-2xl text-center">
                  <div className="text-3xl font-serif font-bold text-white mb-1">{items.filter(i => i.status === 'CLAIMED').length}</div>
                  <div className="text-[10px] font-bold text-sky uppercase tracking-widest">Reunited Items</div>
                </div>
             </div>
          </div>
        </header>
      )}

      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Search Bar Floating */}
        {activePage === 'home' && (
          <div className="max-w-2xl mx-auto -mt-20 mb-16 relative z-10">
            <div className="bg-white rounded-3xl shadow-2xl p-2 flex items-center gap-4 border-4 border-beige">
              <Search className="text-text-mid ml-4" size={24} />
              <input 
                type="text" 
                placeholder="Search for your lost item... (e.g., 'Blue Wallet')" 
                className="flex-1 bg-transparent border-none outline-none text-text-dark font-medium placeholder:text-text-mid/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => activePage !== 'listings' && setActivePage('listings')}
              />
              <button className="bg-navy text-white px-8 py-3.5 rounded-2xl font-bold hover:bg-teal transition-all" onClick={() => setActivePage('listings')}>Search</button>
            </div>
          </div>
        )}

        {/* Listings Content */}
        {(activePage === 'home' || activePage === 'listings') && (
          <section className="mb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
              <div>
                <h2 className="font-serif text-3xl font-bold text-navy mb-2">
                  {activePage === 'home' ? 'Recent Reports' : 'All Listings'}
                </h2>
                <p className="text-text-mid">Helping the campus stay connected and organized.</p>
              </div>

              {activePage === 'listings' && (
                <div className="flex flex-wrap gap-2">
                  {(['all', 'LOST', 'FOUND', 'CLAIMED'] as const).map(t => (
                    <button 
                      key={t}
                      className={`px-6 py-2 rounded-full text-xs font-bold transition-all ${typeFilter === t ? 'bg-navy text-white shadow-lg' : 'bg-white text-text-mid hover:bg-sky/20'}`}
                      onClick={() => setTypeFilter(t)}
                    >
                      {t === 'all' ? 'All Items' : t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Filters Row (Listings Page only) */}
            {activePage === 'listings' && (
              <div className="flex flex-wrap gap-3 mb-10">
                 <select className="bg-white border-2 border-sky/30 px-4 py-2.5 rounded-xl text-sm font-bold text-text-mid outline-none focus:border-teal transition-all" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                   <option value="">All Categories</option>
                   {CATEGORIES.map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}
                 </select>
                 <select className="bg-white border-2 border-sky/30 px-4 py-2.5 rounded-xl text-sm font-bold text-text-mid outline-none focus:border-teal transition-all" value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
                   <option value="">All Locations</option>
                   {LOCATIONS.map(l => <option key={l} value={l}>{LOC_EMOJI[l]} {l}</option>)}
                 </select>
                 <div className="flex-1 min-w-[200px]">
                   <div className="relative">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-mid" size={16} />
                     <input 
                       type="text" 
                       placeholder="Quick search..." 
                       className="w-full bg-white border-2 border-sky/30 pl-11 pr-4 py-2.5 rounded-xl text-sm font-bold text-text-dark outline-none focus:border-teal transition-all"
                       value={searchQuery}
                       onChange={(e) => setSearchQuery(e.target.value)}
                     />
                   </div>
                 </div>
              </div>
            )}

            {loading ? (
              <div className="loader"><span></span><span></span><span></span></div>
            ) : filteredItems.length === 0 ? (
              <div className="bg-white/50 border-2 border-dashed border-sky/40 rounded-3xl p-20 text-center">
                <div className="text-6xl mb-6 grayscale opacity-50">🔍</div>
                <h3 className="text-xl font-bold text-navy mb-2">No records found</h3>
                <p className="text-text-mid max-w-sm mx-auto mb-8">Try adjusting your filters or be the first to report this item category.</p>
                <button className="bg-navy text-white px-8 py-3 rounded-xl font-bold" onClick={() => { resetForm(); setShowReportModal(true); }}>Make a Report</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {(activePage === 'home' ? filteredItems.slice(0, 8) : filteredItems).map(item => (
                  <ItemCard key={item.id} item={item} setSelectedItem={setSelectedItem} getTimeAgo={getTimeAgo} searchQuery={searchQuery} />
                ))}
              </div>
            )}

            
            {activePage === 'home' && filteredItems.length > 8 && (
              <div className="mt-16 text-center">
                <button className="bg-teal/10 hover:bg-teal group text-teal hover:text-white px-10 py-4 rounded-2xl font-bold transition-all border-2 border-teal/20 inline-flex items-center gap-3" onClick={() => setActivePage('listings')}>
                  View all campus reports <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            )}
          </section>
        )}

        {/* How it Works / About App */}
        {activePage === 'how' && (
          <section className="animate-fadeUp max-w-4xl mx-auto">
             <div className="text-center mb-16">
               <h2 className="font-serif text-4xl font-bold text-navy mb-6">Simplifying Campus Lost & Found</h2>
               <p className="text-text-mid text-lg leading-relaxed">No more infinite scrolling in messy WhatsApp groups. FindIt provides a structured, searchable dashboard for everyone on campus.</p>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-20">
                <div className="bg-white p-10 rounded-[40px] shadow-xl border border-sky/20">
                   <div className="w-16 h-16 bg-red-100 rounded-3xl flex items-center justify-center text-red-600 mb-8 border-2 border-red-200">📢</div>
                   <h3 className="text-2xl font-bold text-navy mb-4 font-serif">Report Instantly</h3>
                   <p className="text-text-mid leading-relaxed mb-6">Spend 30 seconds filling out our smart form. Include categorization and location tags to help matching algorithms.</p>
                   <div className="h-1 bg-gradient-to-r from-red-200 to-transparent rounded-full" />
                </div>
                <div className="bg-white p-10 rounded-[40px] shadow-xl border border-sky/20">
                   <div className="w-16 h-16 bg-blue-100 rounded-3xl flex items-center justify-center text-blue-600 mb-8 border-2 border-blue-200">🔍</div>
                   <h3 className="text-2xl font-bold text-navy mb-4 font-serif">Search Effectively</h3>
                   <p className="text-text-mid leading-relaxed mb-6">Use advanced filters to pinpoint your item. Search across departments and buildings from one unified interface.</p>
                   <div className="h-1 bg-gradient-to-r from-blue-200 to-transparent rounded-full" />
                </div>
             </div>

             <div className="bg-navy rounded-[48px] p-8 md:p-16 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-teal opacity-20 blur-[100px] -mr-40 -mt-40" />
                <h3 className="text-2xl md:text-3xl font-serif font-bold mb-10 relative z-10">Why move from messaging groups?</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 relative z-10">
                   <div className="space-y-6">
                      <h4 className="font-bold text-sky uppercase tracking-tighter text-sm">❌ The WhatsApp Way</h4>
                      <ul className="space-y-4 opacity-70">
                         <li className="flex items-center gap-3">🪫 Messages get buried instantly</li>
                         <li className="flex items-center gap-3">🪫 No way to filter by "keys" or "library"</li>
                         <li className="flex items-center gap-3">🪫 Limited to whoever is in the group</li>
                         <li className="flex items-center gap-3">🪫 Constant spam notifications</li>
                      </ul>
                   </div>
                   <div className="space-y-6">
                      <h4 className="font-bold text-teal-light uppercase tracking-tighter text-sm">✅ The FindIt Way</h4>
                      <ul className="space-y-4">
                         <li className="flex items-center gap-3">💎 Persistent, searchable dashboard</li>
                         <li className="flex items-center gap-3">💎 Instant filtering & smart search</li>
                         <li className="flex items-center gap-3">💎 Campus-wide visibility (all Depts)</li>
                         <li className="flex items-center gap-3">💎 One-click status updates</li>
                      </ul>
                   </div>
                </div>
             </div>
          </section>
        )}

        {/* Admin Section */}
        {activePage === 'admin' && (
          <section className="animate-fadeUp">
             <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
                <div>
                  <h2 className="font-serif text-4xl font-bold text-navy mb-3">Admin Overlord</h2>
                  <p className="text-text-mid">Manage campus records and platform health.</p>
                </div>
                <div className="flex gap-3">
                   <button className="bg-red-50 text-red-600 font-bold px-6 py-2.5 rounded-xl border border-red-100 hover:bg-red-100 transition-colors" onClick={() => fetchItems()}>Refresh</button>
                   <button 
                     className="bg-navy text-white font-bold px-6 py-2.5 rounded-xl shadow-lg hover:bg-teal transition-all flex items-center gap-2"
                     onClick={exportToCSV}
                   >
                     <FileText size={18} /> Export CSV
                   </button>
                </div>
             </div>

             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                <div className="stat-card border-red-500">
                  <div className="text-3xl font-serif font-bold mb-1">{items.filter(i => i.status === 'LOST').length}</div>
                  <div className="text-xs font-bold text-text-mid uppercase tracking-widest">Active Lost</div>
                </div>
                <div className="stat-card border-green-500">
                  <div className="text-3xl font-serif font-bold mb-1">{items.filter(i => i.status === 'FOUND').length}</div>
                  <div className="text-xs font-bold text-text-mid uppercase tracking-widest">Active Found</div>
                </div>
                <div className="stat-card border-teal">
                  <div className="text-3xl font-serif font-bold mb-1">{items.filter(i => i.status === 'CLAIMED').length}</div>
                  <div className="text-xs font-bold text-text-mid uppercase tracking-widest">Reunited Total</div>
                </div>
                <div className="stat-card border-navy">
                  <div className="text-3xl font-serif font-bold mb-1">{items.length}</div>
                  <div className="text-xs font-bold text-text-mid uppercase tracking-widest">Global Reports</div>
                </div>
             </div>

             <div className="bg-white rounded-[32px] shadow-2xl overflow-hidden border border-sky/20">
                <div className="overflow-x-auto">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Reporter</th>
                        <th>Type</th>
                        <th>Item Details</th>
                        <th>Location</th>
                        <th>Status</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.id} className="hover:bg-beige/50 transition-colors">
                          <td className="py-4 px-6">
                            <div className="font-bold text-text-dark">{item.reporter_name}</div>
                            <div className="text-[10px] text-text-mid font-mono">{item.reporter_roll || 'NO-ROLL'}</div>
                          </td>
                          <td className="py-4 px-6">
                             <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${item.status === 'LOST' ? 'bg-red-100 text-red-600' : (item.status === 'FOUND' ? 'bg-green-100 text-green-600' : 'bg-sky/20 text-navy')}`}>
                               {item.status}
                             </span>
                          </td>
                          <td className="py-4 px-6">
                             <div className="font-bold text-text-dark text-sm">{item.title}</div>
                             <div className="text-[10px] text-text-mid">{item.category}</div>
                          </td>
                          <td className="py-2 px-6">
                             <div className="flex items-center gap-1.5 text-xs text-text-mid font-medium">
                                {LOC_EMOJI[item.location]} {item.location}
                             </div>
                          </td>
                          <td className="py-4 px-6">
                             {item.status === 'CLAIMED' ? (
                               <div className="flex items-center gap-1.5 text-green-600 text-[10px] font-bold">
                                 <CheckCircle2 size={14} /> RESOLVED
                               </div>
                             ) : (
                               <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-bold">
                                 ⚠ PENDING
                               </div>
                             )}
                          </td>
                          <td className="py-4 px-6 text-right">
                             <div className="flex justify-end gap-2">
                               {item.status !== 'CLAIMED' && (
                                 <button 
                                   className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center hover:bg-green-100 transition-all font-bold" 
                                   title="Mark as resolved" 
                                   onClick={() => setConfirmAction({ id: item.id, type: 'resolve', title: item.title })}
                                 >
                                   <CheckCircle2 size={16} />
                                 </button>
                               )}
                               <button 
                                 className="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-200 transition-all font-bold" 
                                 title="Delete record" 
                                 onClick={() => setConfirmAction({ id: item.id, type: 'delete', title: item.title })}
                               >
                                  <Trash2 size={16} />
                               </button>
                             </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
             </div>
          </section>
        )}
      </main>

      <footer className="bg-navy py-12 px-6 text-center mt-20 border-t-8 border-teal/20">
         <div className="nav-logo mx-auto mb-6">F</div>
         <p className="font-serif text-2xl text-white font-bold mb-2">Find<span className="text-sky">It</span></p>
         <p className="text-sky/60 text-sm font-medium mb-10 max-w-md mx-auto">Helping the college campus stay organized and ensuring your valuables always find their way home.</p>
         <div className="flex justify-center gap-8 text-sky/40 text-xs font-bold uppercase tracking-[0.2em]">
            <span>Build 2026.05.07</span>
            <span>·</span>
            <span>DTI Campus Project</span>
            <span>·</span>
            <span>Supabase Cloud</span>
         </div>
      </footer>

      {/* --- MODALS --- */}
      
      {/* Report Modal */}
      {showReportModal && (
        <div className="modal-overlay">
           <div className="modal animate-modalIn">
              <div className="p-8 border-b border-sky/20 flex items-center justify-between">
                 <h2 className="font-serif text-3xl font-bold text-navy">Make a Report</h2>
                 <button className="w-10 h-10 rounded-xl bg-beige text-text-mid flex items-center justify-center hover:bg-sky/20 transition-all" onClick={() => setShowReportModal(false)}><X size={20} /></button>
              </div>
              <div className="p-8 space-y-6">
                 <div>
                    <label className="block text-xs font-black uppercase text-text-mid mb-4">I want to report a...</label>
                    <div className="grid grid-cols-2 gap-4">
                       <button className={`py-4 rounded-2xl border-2 font-bold transition-all ${formData.type === 'LOST' ? 'bg-red-50 border-red-500 text-red-600' : 'bg-white border-sky/30 text-text-mid'}`} onClick={() => setFormData({...formData, type: 'LOST'})}>
                          🔴 I Lost Item
                       </button>
                       <button className={`py-4 rounded-2xl border-2 font-bold transition-all ${formData.type === 'FOUND' ? 'bg-green-50 border-green-500 text-green-600' : 'bg-white border-sky/30 text-text-mid'}`} onClick={() => setFormData({...formData, type: 'FOUND'})}>
                          🟢 I Found Item
                       </button>
                    </div>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-black uppercase text-text-mid px-1">Your Name *</label>
                       <input type="text" placeholder="e.g. Priya Sharma" className="w-full bg-beige/50 border-2 border-sky/20 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-navy transition-all" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} />
                    </div>
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-black uppercase text-text-mid px-1">Roll Number</label>
                       <input type="text" placeholder="e.g. 22CS045" className="w-full bg-beige/50 border-2 border-sky/20 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-navy transition-all" value={formData.roll} onChange={(e) => setFormData({...formData, roll: e.target.value})} />
                    </div>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-black uppercase text-text-mid px-1">Phone *</label>
                       <input type="tel" placeholder="10-digit number" className="w-full bg-beige/50 border-2 border-sky/20 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-navy transition-all" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                    </div>
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-black uppercase text-text-mid px-1">Email</label>
                       <input type="email" placeholder="college email" className="w-full bg-beige/50 border-2 border-sky/20 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-navy transition-all" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} />
                    </div>
                 </div>

                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-text-mid px-1">Item Title *</label>
                    <input type="text" placeholder="e.g. Casio Scientific Calculator FX-991" className="w-full bg-beige/50 border-2 border-sky/20 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-navy transition-all" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} />
                    
                    {formData.type === 'FOUND' && (
                      <div className="mt-4 p-4 bg-teal/5 border-2 border-teal/20 rounded-2xl space-y-4">
                         <div className="flex items-center gap-2 text-[10px] font-black text-teal uppercase tracking-widest">
                            <Bell size={12} /> Verification Setup
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-navy px-1">Proof Challenge (Question) *</label>
                            <input 
                              type="text" 
                              placeholder="e.g. What is the lock screen wallpaper?" 
                              className="w-full bg-white border border-sky/20 p-3 rounded-xl text-xs font-bold outline-none focus:border-teal transition-all" 
                              value={formData.verification_question}
                              onChange={(e) => setFormData({...formData, verification_question: e.target.value})}
                            />
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-navy px-1">Expected Answer *</label>
                            <input 
                              type="text" 
                              placeholder="e.g. Picture of my cat" 
                              className="w-full bg-white border border-sky/20 p-3 rounded-xl text-xs font-bold outline-none focus:border-teal transition-all" 
                              value={formData.verification_answer}
                              onChange={(e) => setFormData({...formData, verification_answer: e.target.value})}
                            />
                            <p className="text-[9px] text-text-mid italic mt-1 px-1">This will be used to verify the owner before revealing your contact.</p>
                         </div>
                      </div>
                    )}
                    
                    {duplicateMatches.length > 0 && (
                      <div className="mt-3 bg-teal/10 border border-teal/30 p-4 rounded-xl animate-bounce">
                        <div className="text-[10px] font-bold text-teal flex items-center gap-2 mb-2">
                           <Bell size={12} /> IS THIS THE ITEM YOU FOUND?
                        </div>
                        <p className="text-[10px] text-navy mb-2">Wait! These items were reported LOST. Is one of them what you are reporting?</p>
                        <div className="space-y-2">
                           {duplicateMatches.slice(0, 2).map(match => (
                             <button 
                               key={match.id} 
                               className="w-full bg-white/80 p-2 rounded-lg text-[10px] font-bold text-navy flex items-center justify-between hover:bg-white transition-all shadow-sm"
                               onClick={() => {
                                 setSelectedItem(match);
                                 setShowReportModal(false);
                               }}
                             >
                               <span className="flex items-center gap-2">{CAT_EMOJI[match.category] || '📦'} {match.title}</span>
                               <span className="flex items-center gap-1 text-teal">Contact Owner <ArrowRight size={10} /></span>
                             </button>
                           ))}
                        </div>
                      </div>
                    )}
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-black uppercase text-text-mid px-1">Category *</label>
                       <select className="w-full bg-beige/50 border-2 border-sky/20 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-navy transition-all cursor-pointer" value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})}>
                          <option value="">Select Category</option>
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                       </select>
                    </div>
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-black uppercase text-text-mid px-1">Location *</label>
                       <select className="w-full bg-beige/50 border-2 border-sky/20 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-navy transition-all cursor-pointer" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})}>
                          <option value="">Select Location</option>
                          {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                       </select>
                    </div>
                 </div>

                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-text-mid px-1">Attach Media (Images/Video)</label>
                    <div 
                      className="relative border-2 border-dashed border-sky/30 rounded-2xl p-6 transition-all hover:border-teal hover:bg-teal/5 group cursor-pointer"
                      onClick={() => document.getElementById('media-upload')?.click()}
                    >
                      <input 
                        id="media-upload"
                        type="file" 
                        multiple
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) {
                            setFormData({
                              ...formData, 
                              media: [...formData.media, ...Array.from(e.target.files)]
                            });
                          }
                        }}
                      />
                      <div className="flex flex-col items-center gap-2 text-center">
                        <UploadCloud className="text-sky group-hover:text-teal transition-colors" size={32} />
                        <div>
                          <p className="text-sm font-bold text-navy">Click or Drag to Upload</p>
                          <p className="text-[10px] text-text-mid uppercase font-bold">Files supported: JPG, PNG, MP4</p>
                        </div>
                      </div>
                    </div>
                    
                    {formData.media.length > 0 && (
                      <div className="grid grid-cols-4 gap-2 mt-4">
                        {formData.media.map((file, idx) => (
                          <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-sky/20 group">
                            {file.type.startsWith('image/') ? (
                              <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-navy/10 flex items-center justify-center text-navy">
                                <Film size={24} />
                              </div>
                            )}
                            <button 
                              className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newMedia = [...formData.media];
                                newMedia.splice(idx, 1);
                                setFormData({...formData, media: newMedia});
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                 </div>

                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-text-mid px-1">Full Description</label>
                    <textarea placeholder="Mention specific identifiers (e.g. scratches, color shade, specific stickers)..." rows={3} className="w-full bg-beige/50 border-2 border-sky/20 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-navy transition-all resize-none" value={formData.desc} onChange={(e) => setFormData({...formData, desc: e.target.value})} />
                 </div>

                 <button 
                  disabled={uploading}
                  className={`w-full ${uploading ? 'bg-text-mid cursor-not-allowed' : 'bg-navy hover:bg-teal'} text-white text-lg font-bold p-5 rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3`} 
                  onClick={submitReport}
                 >
                    {uploading ? (
                      <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Uploading...</>
                    ) : (
                      <>Submit Campus Report <ArrowRight size={20} /></>
                    )}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Details Modal */}
      {selectedItem && (
        <div className="modal-overlay">
           <div className="modal animate-modalIn max-w-[600px]">
              <div className="p-8 border-b border-sky/20 flex items-center justify-between">
                 <h2 className="font-serif text-3xl font-bold text-navy truncate flex-1 pr-4">
                   <HighlightedText text={selectedItem.title} highlight={searchQuery} />
                 </h2>
                 <button className="w-10 h-10 rounded-xl bg-beige text-text-mid flex items-center justify-center hover:bg-sky/20 transition-all" onClick={() => setSelectedItem(null)}><X size={20} /></button>
              </div>
              <div className="p-8">
                 <div className="bg-sky/20 rounded-3xl overflow-hidden mb-8 min-h-[160px] flex items-center justify-center relative shadow-inner">
                    {selectedItem.media_urls && selectedItem.media_urls.length > 0 ? (
                      <div className="w-full flex flex-col gap-4">
                        <img src={selectedItem.media_urls[0]} alt={selectedItem.title} className="w-full h-auto max-h-[300px] object-cover rounded-2xl" />
                        {selectedItem.media_urls.length > 1 && (
                          <div className="grid grid-cols-4 gap-2 px-1">
                            {selectedItem.media_urls.slice(1).map((url, i) => (
                              <div key={i} className="aspect-square rounded-xl overflow-hidden border border-sky/20">
                                <img src={url} className="w-full h-full object-cover" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-8xl">{CAT_EMOJI[selectedItem.category]}</span>
                    )}
                 </div>
                 
                 <div className="flex gap-3 mb-10">
                    <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-tighter shadow-sm ${selectedItem.status === 'LOST' ? 'bg-red-100 text-red-600 border border-red-200' : (selectedItem.status === 'FOUND' ? 'bg-green-100 text-green-600 border border-green-200' : 'bg-sky/20 text-navy')}`}>
                      {selectedItem.status}
                    </span>
                    <span className="bg-beige border border-sky/20 px-4 py-1.5 rounded-full text-xs text-text-mid font-bold">🏷️ {selectedItem.category}</span>
                 </div>

                 <p className="text-text-mid text-lg leading-relaxed mb-10 pb-10 border-b border-sky/10">
                   {selectedItem.description ? (
                     <HighlightedText text={selectedItem.description} highlight={searchQuery} />
                   ) : (
                     'The reporter has not provided a detailed description. Please use the contact information below to inquire about specific details.'
                   )}
                 </p>

                 <div className="grid grid-cols-2 gap-6 mb-12">
                    <div className="space-y-1">
                       <label className="text-[10px] font-black uppercase text-text-mid tracking-widest block">Location</label>
                       <div className="font-bold text-navy flex items-center gap-2">{LOC_EMOJI[selectedItem.location]} {selectedItem.location}</div>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black uppercase text-text-mid tracking-widest block">Reported On</label>
                       <div className="font-bold text-navy flex items-center gap-2"><Calendar size={16} /> {new Date(selectedItem.created_at).toLocaleDateString()}</div>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black uppercase text-text-mid tracking-widest block">Reporter</label>
                       <div className="font-bold text-navy flex items-center gap-2"><User size={16} /> {selectedItem.reporter_name}</div>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black uppercase text-text-mid tracking-widest block">Roll No.</label>
                       <div className="font-bold text-navy flex items-center gap-2">🎓 {selectedItem.reporter_roll || 'N/A'}</div>
                    </div>
                 </div>

                 <div className="bg-gradient-to-br from-navy to-teal rounded-[32px] p-8 text-white shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white opacity-10 rounded-full -mr-10 -mt-10" />
                    
                    {selectedItem.status === 'FOUND' && !isVerified && activePage !== 'admin' ? (
                       <div className="space-y-4">
                          <h4 className="text-xs font-black uppercase tracking-widest opacity-60 mb-2 flex items-center gap-2">
                             🔒 Identity Verification Required
                          </h4>
                          <div className="bg-white/10 p-5 rounded-2xl border border-white/20">
                             <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-2">The Finder Asks:</p>
                             <p className="text-lg font-serif italic mb-4 leading-tight">"{selectedItem.verification_question || 'Please describe a unique feature of this item to verify ownership.'}"</p>
                             <input 
                               type="text" 
                               placeholder="Type your answer here..."
                               className="w-full bg-white/10 border-2 border-white/20 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-sky transition-all placeholder:text-white/40 mb-3"
                               value={userAnswer}
                               onChange={(e) => setUserAnswer(e.target.value)}
                               onKeyDown={(e) => {
                                 if (e.key === 'Enter') {
                                   validateVerification();
                                 }
                               }}
                             />
                             <button 
                               className="w-full bg-sky text-navy font-black py-3 rounded-xl hover:bg-white transition-all uppercase text-[10px] tracking-widest"
                               onClick={validateVerification}
                             >
                               Reveal Contact Details
                             </button>
                             <p className="text-[8px] opacity-40 mt-3 text-center uppercase font-bold tracking-tighter">Verified by finder's proof challenge.</p>
                          </div>
                       </div>
                    ) : (
                       <>
                        <h4 className="text-xs font-black uppercase tracking-widest opacity-60 mb-6 flex items-center gap-2">
                           {selectedItem.status === 'LOST' ? '📞 Found this item?' : '📞 Claim this item'}
                        </h4>
                        <div className="space-y-5">
                           <div className="flex items-center gap-5">
                              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center"><Phone size={20} /></div>
                              <div>
                                 <div className="text-xl font-bold">{selectedItem.contact}</div>
                                 <div className="text-[10px] opacity-60 font-bold uppercase tracking-tighter">Phone Contact</div>
                              </div>
                           </div>
                           {selectedItem.reporter_email && (
                             <div className="flex items-center gap-5">
                                <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center"><Mail size={20} /></div>
                                <div>
                                   <div className="text-sm font-bold opacity-90">{selectedItem.reporter_email}</div>
                                   <div className="text-[10px] opacity-60 font-bold uppercase tracking-tighter">Campus Email</div>
                                </div>
                             </div>
                           )}
                        </div>
                       </>
                    )}
                 </div>
                 
                 {selectedItem.status !== 'CLAIMED' && (
                    <div className="space-y-4">
                      {potentialMatches.length > 0 && (
                        <div className="bg-sky/10 border border-sky/30 rounded-2xl p-4 mb-2 animate-pulse">
                          <div className="flex items-center gap-2 text-navy font-bold text-xs mb-2">
                             <Bell size={14} className="text-teal" /> POTENTIAL MATCHES FOUND ({potentialMatches.length})
                          </div>
                          <div className="space-y-2">
                            {potentialMatches.slice(0, 2).map(match => (
                              <button 
                                key={match.id}
                                className="w-full bg-white/60 hover:bg-white p-2 rounded-lg text-left text-[10px] flex items-center justify-between group transition-all"
                                onClick={() => setSelectedItem(match)}
                              >
                                <span className="font-bold text-navy">{CAT_EMOJI[match.category]} {match.title}</span>
                                <ArrowRight size={12} className="text-sky group-hover:translate-x-1 transition-all" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <button 
                        className="w-full mt-6 bg-green-500 text-white font-bold p-4 rounded-2xl hover:bg-green-600 transition-all flex items-center justify-center gap-2 shadow-lg" 
                        onClick={() => setConfirmAction({ id: selectedItem.id, type: 'resolve', title: selectedItem.title })}
                      >
                        <CheckCircle2 size={20} /> Mark Item as Reunited / Resolved
                      </button>
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* Toast Alert */}
      {toast && (
        <div className={`toast fixed bottom-6 right-6 px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-fadeUp z-[1000] border-l-8 ${toast.type === 'success' ? 'bg-navy border-green-500' : (toast.type === 'error' ? 'bg-navy border-red-500' : 'bg-navy border-sky')}`}>
          <div className="text-white font-bold text-sm">{toast.msg}</div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="modal-overlay z-[1000]">
          <div className="bg-white rounded-[32px] w-[95%] max-w-md p-8 shadow-2xl animate-modalIn border-t-8 border-navy mx-auto">
            <div className="w-16 h-16 bg-beige rounded-2xl flex items-center justify-center text-navy mb-6 mx-auto">
              {confirmAction.type === 'delete' ? <Trash2 size={32} /> : <CheckCircle2 size={32} />}
            </div>
            <h3 className="text-2xl font-serif font-bold text-navy text-center mb-2">
              {confirmAction.type === 'delete' ? 'Confirm Deletion' : 'Mark as Resolved?'}
            </h3>
            <p className="text-text-mid text-center mb-8">
              Are you sure you want to {confirmAction.type === 'delete' ? 'delete' : 'resolve'} the report for <span className="font-bold text-navy">"{confirmAction.title}"</span>? 
              {confirmAction.type === 'delete' && ' This action cannot be undone.'}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <button 
                className="py-4 rounded-2xl bg-beige text-navy font-bold hover:bg-sky/20 transition-all"
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </button>
              <button 
                className={`py-4 rounded-2xl text-white font-bold transition-all shadow-lg ${confirmAction.type === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                onClick={() => {
                  if (confirmAction.type === 'delete') deleteItem(confirmAction.id);
                  else resolveItem(confirmAction.id);
                  setConfirmAction(null);
                }}
              >
                Yes, {confirmAction.type === 'delete' ? 'Delete' : 'Resolve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---
const HighlightedText = ({ text, highlight }: { text: string; highlight: string }) => {
  if (!highlight.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
  return (
    <>
      {parts.map((part, i) => 
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-yellow-200 text-black px-0.5 rounded">{part}</span>
        ) : (
          part
        )
      )}
    </>
  );
};

const Navbar = ({ 
  activePage, 
  setActivePage, 
  setShowReportModal, 
  notifications, 
  setShowNotifPanel, 
  showNotifPanel, 
  saveNotifications, 
  getTimeAgo 
}: any) => (
  <nav className="bg-navy sticky top-0 z-100 flex items-center justify-between px-4 md:px-8 h-[64px] shadow-lg">
    <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActivePage('home')}>
      <div className="nav-logo">F</div>
      <span className="font-serif text-xl font-bold text-white tracking-tight">Find<span className="text-sky">It</span></span>
    </div>
    <div className="flex items-center gap-1 md:gap-4">
      <button className={`nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activePage === 'home' ? 'text-white bg-white/10' : 'text-sky hover:text-white'}`} onClick={() => setActivePage('home')}>Home</button>
      <button className={`nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activePage === 'listings' ? 'text-white bg-white/10' : 'text-sky hover:text-white'}`} onClick={() => setActivePage('listings')}>Browse</button>
      <button className={`nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hidden md:block ${activePage === 'how' ? 'text-white bg-white/10' : 'text-sky hover:text-white'}`} onClick={() => setActivePage('how')}>How It Works</button>
      <button className={`nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hidden md:block ${activePage === 'admin' ? 'text-white bg-white/10' : 'text-sky hover:text-white'}`} onClick={() => setActivePage('admin')}>Admin</button>
      
      <div className="relative">
        <button className="w-10 h-10 rounded-xl bg-sky/10 border border-sky/20 text-sky flex items-center justify-center hover:bg-sky/20 transition-all" onClick={() => setShowNotifPanel(!showNotifPanel)}>
          <Bell size={20} />
          {notifications.some((n: any) => !n.read) && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-navy animate-pulse">
              {notifications.filter((n: any) => !n.read).length}
            </span>
          )}
        </button>
        {showNotifPanel && (
          <div className="absolute top-[calc(100%+12px)] right-0 w-[300px] md:w-[360px] bg-white rounded-2xl shadow-2xl border border-sky/50 z-[300] overflow-hidden animate-dropIn">
            <div className="p-4 bg-gradient-to-br from-navy to-teal flex items-center justify-between">
              <span className="text-white font-serif font-bold">🔔 Notifications</span>
              <button className="text-[10px] text-white/80 hover:text-white font-bold" onClick={() => saveNotifications(notifications.map((n: any) => ({...n, read: true})))}>Mark all read</button>
            </div>
            <div className="max-h-[380px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-10 text-center text-text-mid">No messages yet.</div>
              ) : (
                notifications.map((n: any) => (
                  <div key={n.id} className={`p-4 border-b border-sky/20 transition-colors ${!n.read ? 'bg-sky/10' : ''}`}>
                    <div className="flex gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.type === 'new_report' ? 'bg-red-500' : 'bg-green-500'}`} />
                      <div>
                        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${n.type === 'new_report' ? 'text-red-600' : 'text-green-600'}`}>
                          {n.type === 'new_report' ? `New ${n.reportType} Report` : 'Reunited'}
                        </div>
                        <div className="text-xs text-text-dark leading-relaxed">
                          {n.type === 'new_report' 
                            ? <span><strong>{n.itemName}</strong> was reported at campus by <strong>{n.reporter}</strong>.</span>
                            : <span><strong>{n.itemName}</strong> has been returned!</span>
                          }
                        </div>
                        <div className="text-[10px] text-text-mid mt-1">{getTimeAgo(new Date(n.ts).toISOString())}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <button className="bg-teal text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg hover:bg-teal-light transition-all flex items-center gap-2" onClick={() => setShowReportModal(true)}>
        <Plus size={18} /> <span className="hidden sm:inline">Report Item</span>
      </button>
    </div>
  </nav>
);

const ItemCard = ({ item, setSelectedItem, getTimeAgo, searchQuery }: any) => {
  const isResolved = item.status === 'CLAIMED';
  const hasMedia = item.media_urls && item.media_urls.length > 0;
  
  return (
    <div className="item-card flex flex-col group" onClick={() => setSelectedItem(item)}>
      <div className="card-img relative overflow-hidden h-40">
         {hasMedia ? (
           <img src={item.media_urls[0]} alt={item.title} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
         ) : (
           <span className="text-5xl">{CAT_EMOJI[item.category] || '📦'}</span>
         )}
         {hasMedia && item.media_urls.length > 1 && (
           <div className="absolute bottom-2 right-2 bg-navy/80 text-white text-[10px] px-2 py-1 rounded-md font-bold backdrop-blur-sm">
             +{item.media_urls.length - 1} more
           </div>
         )}
         <span className={`card-badge ${isResolved ? 'badge-resolved' : (item.status === 'LOST' ? 'badge-lost' : 'badge-found')}`}>
           {isResolved ? 'Resolved' : item.status}
         </span>
      </div>
      <div className="p-5 flex-1 flex flex-col">
        <h3 className="font-bold text-lg text-text-dark mb-2 line-clamp-1">
          <HighlightedText text={item.title} highlight={searchQuery} />
        </h3>
        <div className="flex flex-wrap gap-2 mb-3">
           <span className="flex items-center gap-1 text-xs text-text-mid bg-beige px-2 py-1 rounded-md">
             <MapPin size={12} /> {item.location}
           </span>
           <span className="flex items-center gap-1 text-xs text-text-mid bg-beige px-2 py-1 rounded-md">
             {CAT_EMOJI[item.category] || '📦'} {item.category}
           </span>
        </div>
        <p className="text-sm text-text-mid line-clamp-2 mb-4 flex-1">
          {item.description ? (
            <HighlightedText text={item.description} highlight={searchQuery} />
          ) : (
            'No additional details provided.'
          )}
        </p>
        <div className="flex items-center justify-between pt-4 border-t border-sky/30">
          <span className="text-xs text-text-mid font-medium italic">🕐 {getTimeAgo(item.created_at)}</span>
          <button className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${isResolved ? 'bg-sky/20 text-navy cursor-default' : 'bg-navy text-white hover:bg-teal'}`}>
            {isResolved ? '✓ Claimed' : (item.status === 'LOST' ? 'I Found It' : 'Claim Item')}
          </button>
        </div>
      </div>
    </div>
  );
};

