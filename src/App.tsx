/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  Plus, 
  Trash2, 
  Users, 
  ChevronLeft, 
  ChevronRight,
  Check,
  X,
  Beer
} from 'lucide-react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isSameDay, 
  addDays, 
  eachDayOfInterval,
  isToday,
  parseISO
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Vote {
  id: number;
  date_id: number;
  user_name: string;
}

interface AppointmentDate {
  id: number;
  appointment_id: number;
  date: string;
  vote_count: number;
  voters: string | null;
}

interface Appointment {
  id: number;
  title: string;
  created_at: string;
  dates?: AppointmentDate[];
}

export default function App() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [userName, setUserName] = useState<string>(localStorage.getItem('voter_name') || '');
  const [newAppointmentTitle, setNewAppointmentTitle] = useState('');
  const [newAppointmentPassword, setNewAppointmentPassword] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [appointmentToDelete, setAppointmentToDelete] = useState<number | null>(null);
  const [highlightDate, setHighlightDate] = useState<string | null>(null);

  // Fetch appointments list
  const fetchAppointments = async () => {
    const res = await fetch('/api/appointments');
    const data = await res.json();
    setAppointments(data);
  };

  // Fetch specific appointment details
  const fetchAppointmentDetails = async (id: number) => {
    try {
      const res = await fetch(`/api/appointments/${id}`);
      const data = await res.json();
      if (res.ok) {
        setSelectedAppointment(data);
      } else {
        console.error('Error fetching details:', data.error);
        setSelectedAppointment(null);
      }
    } catch (error) {
      console.error('Network error fetching details:', error);
    }
  };

  useEffect(() => {
    fetchAppointments();

    // WebSocket for real-time
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
      const { type, payload } = JSON.parse(event.data);
      
      if (type === 'APPOINTMENT_CREATED' || type === 'APPOINTMENT_DELETED') {
        fetchAppointments();
      } 
    };

    return () => ws.close();
  }, []);

  // Separate effect to handle specific appointment updates to avoid stale closures
  useEffect(() => {
    if (!selectedAppointment?.id) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
      const { type, payload } = JSON.parse(event.data);
      if (
        (type === 'DATE_ADDED' || type === 'VOTE_UPDATED' || type === 'DATE_REMOVED') && 
        payload.appointmentId === selectedAppointment.id
      ) {
        fetchAppointmentDetails(selectedAppointment.id);
      }
      if (type === 'APPOINTMENT_DELETED' && payload.id === selectedAppointment.id) {
        setSelectedAppointment(null);
      }
    };

    return () => ws.close();
  }, [selectedAppointment?.id]);

  const handleCreateAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppointmentTitle.trim()) return;
    setIsCreateModalOpen(true);
  };

  const confirmCreate = async () => {
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: newAppointmentTitle,
          password: newAppointmentPassword.trim() || null
        }),
      });
      if (res.ok) {
        setNewAppointmentTitle('');
        setNewAppointmentPassword('');
        setIsCreateModalOpen(false);
      } else {
        const error = await res.json();
        alert(error.error || 'Không thể tạo buổi hẹn.');
      }
    } catch (error) {
      alert('Lỗi kết nối máy chủ.');
    }
  };

  const handleDeleteAppointment = (id: number) => {
    setAppointmentToDelete(id);
    setPasswordInput('');
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (appointmentToDelete === null || appointmentToDelete === undefined) return;

    try {
      const res = await fetch(`/api/appointments/${appointmentToDelete}`, { 
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput })
      });

      if (res.ok) {
        setIsDeleteModalOpen(false);
        setAppointmentToDelete(null);
        setPasswordInput('');
      } else {
        const error = await res.json();
        alert(error.error || 'Không thể xoá buổi hẹn.');
      }
    } catch (error) {
      alert('Lỗi kết nối máy chủ khi xoá.');
    }
  };

  const handleSuggestedDateClick = (dateStr: string) => {
    const date = parseISO(dateStr);
    setCurrentMonth(date);
    setSelectedDate(date);
    setHighlightDate(dateStr);
    setTimeout(() => setHighlightDate(null), 2000);
  };

  const handleAddDate = async (date: Date) => {
    if (!selectedAppointment) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    const res = await fetch(`/api/appointments/${selectedAppointment.id}/dates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr }),
    });
    if (!res.ok) {
      alert('Ngày này đã có trong danh sách!');
    }
  };

  const handleRemoveDate = async (dateId: number) => {
    if (!selectedAppointment) return;
    
    const dateToRemove = selectedAppointment.dates?.find(d => d.id === dateId);
    
    // Optimistic update
    setSelectedAppointment(prev => {
      if (!prev) return null;
      return {
        ...prev,
        dates: prev.dates?.filter(d => d.id !== dateId)
      };
    });

    const res = await fetch(`/api/appointments/${selectedAppointment.id}/dates/${dateId}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      fetchAppointmentDetails(selectedAppointment.id);
      alert('Không thể xoá ngày này. Vui lòng thử lại.');
    } else if (dateToRemove && selectedDate && isSameDay(parseISO(dateToRemove.date), selectedDate)) {
      setSelectedDate(null);
    }
  };

  const handleVote = async (dateId: number) => {
    if (!userName.trim()) {
      alert('Vui lòng nhập tên của bạn!');
      return;
    }
    localStorage.setItem('voter_name', userName);

    // Optimistic update
    setSelectedAppointment(prev => {
      if (!prev) return null;
      return {
        ...prev,
        dates: prev.dates?.map(d => {
          if (d.id === dateId) {
            const currentVoters = d.voters ? d.voters.split(',') : [];
            if (!currentVoters.includes(userName)) {
              return {
                ...d,
                vote_count: d.vote_count + 1,
                voters: [...currentVoters, userName].join(',')
              };
            }
          }
          return d;
        })
      };
    });

    const res = await fetch('/api/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateId, userName, appointmentId: selectedAppointment?.id }),
    });

    if (!res.ok) {
      fetchAppointmentDetails(selectedAppointment!.id);
    }
  };

  const handleUnvote = async (dateId: number) => {
    if (!userName.trim()) return;

    // Optimistic update
    setSelectedAppointment(prev => {
      if (!prev) return null;
      return {
        ...prev,
        dates: prev.dates?.map(d => {
          if (d.id === dateId) {
            const currentVoters = d.voters ? d.voters.split(',') : [];
            if (currentVoters.includes(userName)) {
              return {
                ...d,
                vote_count: Math.max(0, d.vote_count - 1),
                voters: currentVoters.filter(v => v !== userName).join(',')
              };
            }
          }
          return d;
        })
      };
    });

    const res = await fetch('/api/votes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateId, userName, appointmentId: selectedAppointment?.id }),
    });

    if (!res.ok) {
      fetchAppointmentDetails(selectedAppointment!.id);
    }
  };

  // Calendar Logic
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  // Relative Vote Levels Logic
  const maxVotes = useMemo(() => {
    if (!selectedAppointment?.dates) return 0;
    return Math.max(0, ...selectedAppointment.dates.map(d => d.vote_count));
  }, [selectedAppointment?.dates]);

  const getVoteLevel = (count: number) => {
    if (count === 0 || maxVotes === 0) return '';
    const ratio = count / maxVotes;
    if (ratio <= 0.33) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (ratio <= 0.66) return 'bg-emerald-300 text-emerald-900 border-emerald-400';
    return 'bg-emerald-500 text-white border-emerald-600';
  };

  const votedDates = useMemo(() => {
    if (!selectedAppointment?.dates) return [];
    return selectedAppointment.dates
      .filter(d => d.vote_count > 0)
      .sort((a, b) => b.vote_count - a.vote_count);
  }, [selectedAppointment?.dates]);

  return (
    <div className="min-h-screen bg-brand-paper text-brand-dark font-sans selection:bg-brand-gold/20">
      {/* Top Navigation / Logo Bar */}
      <header className="border-b border-brand-dark/5 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-brand-dark rounded-xl flex items-center justify-center text-brand-gold shadow-lg shadow-brand-dark/10">
              <Beer size={28} strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="grit-logo text-3xl leading-none tracking-tight">Grit</h1>
              <p className="text-[11px] uppercase tracking-[0.2em] font-extrabold text-brand-gold">Bia và Rượu</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative group">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-dark/30 w-4 h-4 group-focus-within:text-brand-gold transition-colors" />
              <input
                type="text"
                placeholder="Tên của bạn..."
                className="pl-10 pr-4 py-2.5 bg-brand-paper border border-brand-dark/5 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold text-sm transition-all w-40 md:w-64 font-bold"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Sidebar: Appointments List */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-3xl p-6 shadow-xl shadow-brand-dark/5 border border-brand-dark/5">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-extrabold uppercase tracking-widest text-brand-dark">Cuộc hẹn của bạn</h2>
              <div className="w-8 h-8 rounded-full bg-brand-paper flex items-center justify-center border border-brand-dark/5">
                <Plus size={14} className="text-brand-dark/40" />
              </div>
            </div>

            <form onSubmit={handleCreateAppointment} className="mb-8 space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Tên buổi hẹn mới..."
                  className="w-full pl-5 pr-5 py-4 bg-brand-paper rounded-2xl border border-brand-dark/5 focus:outline-none focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold transition-all placeholder:text-brand-dark/20 font-bold"
                  value={newAppointmentTitle}
                  onChange={(e) => setNewAppointmentTitle(e.target.value)}
                />
              </div>
              <div className="relative flex gap-2">
                <input
                  type="password"
                  placeholder="Mật khẩu xoá (tuỳ chọn)..."
                  className="flex-1 pl-5 pr-5 py-3 bg-brand-paper rounded-2xl border border-brand-dark/5 focus:outline-none focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold transition-all placeholder:text-brand-dark/20 text-sm font-bold"
                  value={newAppointmentPassword}
                  onChange={(e) => setNewAppointmentPassword(e.target.value)}
                />
                <button 
                  type="submit"
                  className="w-12 h-12 bg-brand-dark text-brand-gold rounded-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center shadow-lg shadow-brand-dark/20 shrink-0"
                >
                  <Plus size={24} strokeWidth={3} />
                </button>
              </div>
            </form>

            <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {appointments.map((app) => (
                  <motion.div
                    key={app.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => fetchAppointmentDetails(app.id)}
                    className={cn(
                      "group flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border",
                      selectedAppointment?.id === app.id 
                        ? "bg-brand-dark text-white border-brand-dark shadow-lg shadow-brand-dark/20" 
                        : "bg-white border-brand-dark/5 hover:border-brand-gold/50 hover:bg-brand-paper"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                        selectedAppointment?.id === app.id ? "bg-brand-gold text-brand-dark" : "bg-brand-paper text-brand-dark/30"
                      )}>
                        <CalendarIcon size={22} strokeWidth={2.5} />
                      </div>
                      <div>
                        <h3 className="font-extrabold text-sm tracking-tight">{app.title}</h3>
                        <p className={cn(
                          "text-[10px] uppercase tracking-wider font-extrabold",
                          selectedAppointment?.id === app.id ? "text-brand-gold" : "text-brand-dark/20"
                        )}>
                          {format(parseISO(app.created_at), 'dd MMM yyyy')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteAppointment(app.id);
                      }}
                      className={cn(
                        "p-2 rounded-lg transition-all",
                        selectedAppointment?.id === app.id 
                          ? "text-white/20 hover:text-red-400 hover:bg-white/5" 
                          : "text-brand-dark/10 hover:text-red-500 hover:bg-red-50"
                      )}
                    >
                      <Trash2 size={16} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Voted Dates List */}
          {selectedAppointment && votedDates.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-6 shadow-xl shadow-brand-dark/5 border border-brand-dark/5"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold uppercase tracking-widest text-brand-dark/40">Đề xuất hàng đầu</h3>
                <div className="w-8 h-8 rounded-full bg-brand-gold/10 flex items-center justify-center">
                  <Beer size={14} className="text-brand-gold" />
                </div>
              </div>
              <div className="space-y-3">
                {votedDates.map((d) => (
                  <div 
                    key={d.id} 
                    onClick={() => handleSuggestedDateClick(d.date)}
                    className="flex items-center justify-between p-4 bg-brand-paper rounded-2xl border border-brand-dark/5 group hover:border-brand-gold/30 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white flex flex-col items-center justify-center border border-brand-dark/5 shadow-sm">
                        <span className="text-[10px] font-bold text-brand-dark/30 uppercase">{format(parseISO(d.date), 'MMM')}</span>
                        <span className="text-sm font-bold text-brand-dark leading-none">{format(parseISO(d.date), 'dd')}</span>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-brand-dark/40 truncate max-w-[120px]">{d.voters}</p>
                      </div>
                    </div>
                    <div className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-bold border shadow-sm",
                      getVoteLevel(d.vote_count)
                    )}>
                      {d.vote_count} vote
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Main Content: Calendar & Voting */}
        <div className="lg:col-span-8">
          {selectedAppointment ? (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Calendar Grid */}
              <div className="bg-white rounded-[2rem] p-8 shadow-2xl shadow-brand-dark/5 border border-brand-dark/5">
                <div className="flex items-center justify-between mb-10">
                  <div>
                    <h3 className="text-4xl font-serif italic text-brand-dark leading-none mb-1 font-bold">{format(currentMonth, 'MMMM')}</h3>
                    <p className="text-sm font-extrabold uppercase tracking-[0.3em] text-brand-gold">{format(currentMonth, 'yyyy')}</p>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                      className="w-12 h-12 flex items-center justify-center bg-brand-paper hover:bg-brand-dark hover:text-brand-gold rounded-2xl transition-all border border-brand-dark/5 shadow-sm"
                    >
                      <ChevronLeft size={24} strokeWidth={2.5} />
                    </button>
                    <button 
                      onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                      className="w-12 h-12 flex items-center justify-center bg-brand-paper hover:bg-brand-dark hover:text-brand-gold rounded-2xl transition-all border border-brand-dark/5 shadow-sm"
                    >
                      <ChevronRight size={24} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-4">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                    <div key={day} className="py-2 text-center text-[11px] font-extrabold text-brand-dark uppercase tracking-[0.2em]">
                      {day}
                    </div>
                  ))}
                  {days.map((day, i) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const appDate = selectedAppointment.dates?.find(d => d.date === dateStr);
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    
                    return (
                      <motion.div
                        key={i}
                        onClick={() => {
                          setSelectedDate(day);
                          if (!appDate) handleAddDate(day);
                        }}
                        animate={highlightDate === dateStr ? {
                          scale: [1, 1.05, 1],
                          backgroundColor: ['#FFFBEB', '#F59E0B', '#FFFBEB'],
                          transition: { duration: 0.5, repeat: 2 }
                        } : {}}
                        className={cn(
                          "relative aspect-square md:aspect-auto md:h-32 bg-brand-paper rounded-2xl p-3 cursor-pointer transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-brand-dark/5 group/cell border border-transparent",
                          !isCurrentMonth && "opacity-20 grayscale",
                          isSelected && "ring-2 ring-brand-gold ring-offset-4 ring-offset-white z-20 border-brand-gold/20 shadow-2xl shadow-brand-gold/10"
                        )}
                      >
                        <div className="flex justify-between items-start">
                          <span className={cn(
                            "text-base font-extrabold w-9 h-9 flex items-center justify-center rounded-xl transition-colors",
                            isToday(day) && "bg-brand-dark text-brand-gold shadow-lg shadow-brand-dark/20",
                            !isToday(day) && isCurrentMonth && "text-brand-dark group-hover/cell:text-brand-dark",
                          )}>
                            {format(day, 'd')}
                          </span>
                          {appDate && (
                            <div className={cn(
                              "text-xs px-2.5 py-1 rounded-lg font-extrabold border shadow-sm",
                              getVoteLevel(appDate.vote_count) || "bg-white text-brand-dark/40 border-brand-dark/5"
                            )}>
                              {appDate.vote_count}
                            </div>
                          )}
                        </div>

                        {appDate && (
                          <div className="mt-3 space-y-2">
                            <div className="flex flex-wrap gap-1">
                              {appDate.voters?.split(',').slice(0, 2).map((voter, idx) => (
                                <span key={idx} className="text-[9px] bg-white/50 px-1.5 py-0.5 rounded-md text-brand-dark/60 font-medium border border-brand-dark/5">
                                  {voter}
                                </span>
                              ))}
                              {(appDate.voters?.split(',').length || 0) > 2 && (
                                <span className="text-[9px] text-brand-dark/20 font-bold">+{appDate.voters!.split(',').length - 2}</span>
                              )}
                            </div>
                            
                            <div className="absolute bottom-3 right-3 flex gap-1.5 opacity-0 group-hover/cell:opacity-100 transition-all translate-y-2 group-hover/cell:translate-y-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveDate(appDate.id);
                                }}
                                className="w-8 h-8 bg-white text-brand-dark/20 rounded-lg hover:text-red-500 hover:bg-red-50 transition-all border border-brand-dark/5 shadow-sm flex items-center justify-center"
                                title="Bỏ chọn ngày"
                              >
                                <Trash2 size={14} />
                              </button>
                              {appDate.voters?.split(',').includes(userName) ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUnvote(appDate.id);
                                  }}
                                  className="w-8 h-8 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all border border-red-100 shadow-sm flex items-center justify-center"
                                  title="Huỷ vote"
                                >
                                  <X size={14} />
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleVote(appDate.id);
                                  }}
                                  className="w-8 h-8 bg-brand-gold text-brand-dark rounded-lg hover:scale-110 active:scale-95 transition-all shadow-lg shadow-brand-gold/20 flex items-center justify-center"
                                  title="Vote"
                                >
                                  <Check size={14} strokeWidth={3} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
                
                {/* Legend */}
                <div className="mt-10 flex items-center gap-6 text-[11px] font-extrabold uppercase tracking-widest text-brand-dark/30">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-md bg-emerald-100 border border-emerald-200"></div>
                    <span>Thấp</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-md bg-emerald-300 border border-emerald-400"></div>
                    <span>Vừa</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-md bg-emerald-500 border border-emerald-600"></div>
                    <span>Cao</span>
                  </div>
                </div>
              </div>

              {/* Selected Date Details */}
              {selectedDate && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-3xl p-8 shadow-2xl shadow-brand-dark/5 border border-brand-dark/5"
                >
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-xl font-bold tracking-tight">Chi tiết ngày {format(selectedDate, 'dd/MM/yyyy')}</h3>
                      <p className="text-xs text-brand-dark/30 font-bold uppercase tracking-widest mt-1">Danh sách bình chọn</p>
                    </div>
                    <button onClick={() => setSelectedDate(null)} className="w-10 h-10 flex items-center justify-center bg-brand-paper rounded-full text-brand-dark/20 hover:text-brand-dark transition-colors">
                      <X size={20} />
                    </button>
                  </div>
                  
                  {selectedAppointment.dates?.find(d => d.date === format(selectedDate, 'yyyy-MM-dd')) ? (
                    <div className="space-y-6">
                      <div className="flex flex-wrap gap-3">
                        {selectedAppointment.dates?.find(d => d.date === format(selectedDate, 'yyyy-MM-dd'))?.voters?.split(',').map((voter, i) => (
                          <motion.span 
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: i * 0.05 }}
                            key={i} 
                            className="px-5 py-2.5 bg-brand-paper rounded-2xl text-sm font-bold border border-brand-dark/5 shadow-sm flex items-center gap-2"
                          >
                            <div className="w-2 h-2 rounded-full bg-brand-gold"></div>
                            {voter}
                          </motion.span>
                        )) || <p className="text-sm text-brand-dark/30 italic">Chưa có ai vote ngày này.</p>}
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 text-center bg-brand-paper rounded-2xl border border-dashed border-brand-dark/10">
                      <p className="text-sm text-brand-dark/40 font-medium">Nhấn vào ngày để thêm vào danh sách bình chọn.</p>
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          ) : (
            <div className="h-full min-h-[600px] flex flex-col items-center justify-center bg-white rounded-[2rem] border border-dashed border-brand-dark/10 text-brand-dark/20">
              <div className="w-24 h-24 bg-brand-paper rounded-full flex items-center justify-center mb-6">
                <CalendarIcon size={40} strokeWidth={1} />
              </div>
              <p className="font-bold uppercase tracking-widest text-xs">Chọn một buổi hẹn để bắt đầu</p>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCreateModalOpen(false)}
              className="absolute inset-0 bg-brand-dark/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl border border-brand-dark/5"
            >
              <h2 className="text-2xl font-serif italic mb-2 text-brand-dark">Xác nhận tạo buổi hẹn</h2>
              <p className="text-sm text-brand-dark/60 mb-6 font-bold">Bạn đang tạo: <span className="text-brand-gold">{newAppointmentTitle}</span></p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-extrabold text-brand-dark/30 mb-2">Mật khẩu bảo vệ (tuỳ chọn)</label>
                  <input
                    type="password"
                    placeholder="Nhập mật khẩu..."
                    className="w-full px-5 py-4 bg-brand-paper rounded-2xl border border-brand-dark/5 focus:outline-none focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold transition-all font-bold"
                    value={newAppointmentPassword}
                    onChange={(e) => setNewAppointmentPassword(e.target.value)}
                  />
                </div>
                
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setIsCreateModalOpen(false)}
                    className="flex-1 py-4 bg-brand-paper text-brand-dark/40 rounded-2xl font-extrabold hover:bg-brand-dark/5 transition-all"
                  >
                    Huỷ bỏ
                  </button>
                  <button 
                    onClick={confirmCreate}
                    className="flex-1 py-4 bg-brand-gold text-brand-dark rounded-2xl font-extrabold shadow-lg shadow-brand-gold/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Tạo ngay
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isDeleteModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDeleteModalOpen(false)}
              className="absolute inset-0 bg-brand-dark/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl border border-brand-dark/5"
            >
              <h2 className="text-2xl font-serif italic mb-2 text-brand-dark">Xác nhận xoá</h2>
              <p className="text-sm text-brand-dark/60 mb-6 font-bold">Vui lòng nhập mật khẩu để xoá buổi hẹn này.</p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-extrabold text-brand-dark/30 mb-2">Mật khẩu xác nhận</label>
                  <input
                    type="password"
                    placeholder="Nhập mật khẩu..."
                    className="w-full px-5 py-4 bg-brand-paper rounded-2xl border border-brand-dark/5 focus:outline-none focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold transition-all font-bold"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                  />
                </div>
                
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setIsDeleteModalOpen(false)}
                    className="flex-1 py-4 bg-brand-paper text-brand-dark/40 rounded-2xl font-extrabold hover:bg-brand-dark/5 transition-all"
                  >
                    Không
                  </button>
                  <button 
                    onClick={confirmDelete}
                    className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-extrabold shadow-lg shadow-red-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Có, xoá đi
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
